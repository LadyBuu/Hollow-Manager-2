/**
 * js/modules/characters/character-events.js - Character Events
 * Path: js/modules/characters/character-events.js
 * 
 * This module is responsible for ALL event binding for the character module.
 * All event listeners are centralized here to prevent duplication.
 * 
 * IMPORTANT:
 *   - This module binds events AFTER the DOM is rendered
 *   - Uses event delegation where possible for dynamic elements
 *   - All mutations delegate to the appropriate module (CharacterCRUD, CharacterClasses, etc.)
 *   - Safe event binding with proper cleanup
 *   - No inline event handlers in HTML
 * 
 * DEPENDENCIES:
 *   - window.CharacterCRUD
 *   - window.CharacterClasses
 *   - window.CharacterEliminations
 *   - window.CharacterStats
 *   - window.CharacterViews
 *   - window.getCharacterById (from core-utils.js)
 *   - window.getDisplayName (from core-utils.js)
 *   - window.currentEditId (from index.js)
 *   - window.setCurrentEditId (from index.js)
 *   - window.showCharacterForm (from index.js)
 *   - window.toggleCharacterList (from index.js)
 */

(function() {
    'use strict';

    // Guard against duplicate script loading
    if (window.__characterEventsLoaded) {
        return;
    }
    window.__characterEventsLoaded = true;

    // ============================================================
    // STATE
    // ============================================================

    var characterListOpen = false;
    var _initialized = false;
    var _eventListeners = [];

    // ============================================================
    // DEPENDENCY CHECK
    // ============================================================

    function checkDependencies() {
        var required = [
            'getCharacterById',
            'getDisplayName',
            'getClassByName',
            'createClass',
            'getClasses',
            'currentEditId',
            'setCurrentEditId',
            'showCharacterForm',
            'toggleCharacterList'
        ];

        var missing = [];
        required.forEach(function(name) {
            if (name === 'currentEditId' && typeof window.currentEditId !== 'function') {
                missing.push('currentEditId');
            } else if (name === 'setCurrentEditId' && typeof window.setCurrentEditId !== 'function') {
                missing.push('setCurrentEditId');
            } else if (name === 'showCharacterForm' && typeof window.showCharacterForm !== 'function') {
                missing.push('showCharacterForm');
            } else if (name === 'toggleCharacterList' && typeof window.toggleCharacterList !== 'function') {
                missing.push('toggleCharacterList');
            } else if (typeof window[name] !== 'function' && 
                       name !== 'currentEditId' && 
                       name !== 'setCurrentEditId' &&
                       name !== 'showCharacterForm' &&
                       name !== 'toggleCharacterList') {
                missing.push(name);
            }
        });

        if (missing.length > 0) {
            console.warn('CharacterEvents: Missing dependencies:', missing.join(', '));
            return false;
        }
        return true;
    }

    // ============================================================
    // SAFE EVENT BINDING WITH CLEANUP
    // ============================================================

    function addSafeEventListener(element, eventName, handler, options) {
        if (!element) return;
        element.addEventListener(eventName, handler, options || false);
        _eventListeners.push({
            element: element,
            eventName: eventName,
            handler: handler,
            options: options || false
        });
    }

    function removeAllEventListeners() {
        _eventListeners.forEach(function(item) {
            try {
                item.element.removeEventListener(item.eventName, item.handler, item.options);
            } catch (e) {
                // Ignore errors during cleanup
            }
        });
        _eventListeners = [];
    }

    // ============================================================
    // NOTIFICATION
    // ============================================================

    function showNotification(message, type) {
        type = type || 'info';

        if (typeof window.showToast === 'function') {
            window.showToast(message, type);
            return;
        }

        if (typeof window.setSession === 'function') {
            window.setSession('toast', {
                message: message,
                type: type,
                timestamp: Date.now()
            });
            if (typeof window.renderToast === 'function') {
                window.renderToast();
            }
            return;
        }

        // Ultimate fallback - only use alert for errors
        if (type === 'error') {
            alert('Error: ' + message);
        } else {
            alert(message);
        }
    }

    // ============================================================
    // MAIN INITIALIZATION
    // ============================================================

    function init(container) {
        if (_initialized) return;
        if (!checkDependencies()) return;

        if (!container) {
            container = document.getElementById('tab-characters');
        }
        if (!container) return;

        // Remove any existing event listeners before adding new ones
        removeAllEventListeners();

        _initialized = true;

        // Bind all events
        bindToggleList(container);
        bindAddCharacter(container);
        bindFormSubmit(container);
        bindDeleteButton(container);
        bindTabSwitching(container);
        bindFilters(container);
        bindCareerStatus(container);
        bindDeceasedToggle(container);
        bindEliminationControls(container);
        bindClassTagInput(container);
        bindAcademicClassControls(container);
        bindSocialButton(container);
        bindClickOutside(container);
        bindStatsEvents(container);
        bindMagicEvents(container);
        bindSpecialMovesEvents(container);
    }

    // ============================================================
    // TOGGLE CHARACTER LIST
    // ============================================================

    function bindToggleList(container) {
        var toggleBtn = document.getElementById('toggle-char-list');
        if (toggleBtn) {
            addSafeEventListener(toggleBtn, 'click', function(e) {
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

    function bindAddCharacter(container) {
        var addBtn = document.getElementById('add-character-btn');
        if (addBtn) {
            addSafeEventListener(addBtn, 'click', function() {
                if (typeof window.setCurrentEditId === 'function') {
                    window.setCurrentEditId(null);
                }
                if (typeof window.showCharacterForm === 'function') {
                    window.showCharacterForm(null);
                }
                if (window.innerWidth < 768) {
                    toggleCharacterList(false);
                }
            });
        }
    }

    // ============================================================
    // FORM SUBMIT
    // ============================================================

    function bindFormSubmit(container) {
        var form = document.getElementById('char-form');
        if (form) {
            addSafeEventListener(form, 'submit', function(e) {
                e.preventDefault();
                if (window.CharacterCRUD && typeof window.CharacterCRUD.save === 'function') {
                    window.CharacterCRUD.save();
                }
            });
        }
    }

    // ============================================================
    // DELETE BUTTON
    // ============================================================

    function bindDeleteButton(container) {
        var deleteBtn = document.getElementById('delete-char-btn');
        if (deleteBtn) {
            addSafeEventListener(deleteBtn, 'click', function() {
                var id = typeof window.currentEditId === 'function' ? window.currentEditId() : null;
                if (id && window.CharacterCRUD && typeof window.CharacterCRUD.delete === 'function') {
                    window.CharacterCRUD.delete(id);
                }
            });
        }
    }

    // ============================================================
    // TAB SWITCHING
    // ============================================================

    function bindTabSwitching(container) {
        container.querySelectorAll('.char-tab-btn').forEach(function(btn) {
            addSafeEventListener(btn, 'click', function() {
                var tab = this.dataset.tab;
                if (window.CharacterForm && typeof window.CharacterForm.switchTab === 'function') {
                    window.CharacterForm.switchTab(tab);
                }
            });
        });
    }

    // ============================================================
    // FILTERS - With debouncing
    // ============================================================

    function bindFilters(container) {
        var nameFilter = document.getElementById('char-name-filter');
        if (nameFilter) {
            // Debounced render
            var debounceTimer = null;
            addSafeEventListener(nameFilter, 'input', function() {
                clearTimeout(debounceTimer);
                debounceTimer = setTimeout(function() {
                    if (window.CharacterList && typeof window.CharacterList.render === 'function') {
                        window.CharacterList.render();
                    }
                }, 300);
            });
        }

        var statusFilter = document.getElementById('char-status-filter');
        if (statusFilter) {
            addSafeEventListener(statusFilter, 'change', function() {
                if (window.CharacterList && typeof window.CharacterList.render === 'function') {
                    window.CharacterList.render();
                }
            });
        }

        var classFilter = document.getElementById('char-class-filter');
        if (classFilter) {
            addSafeEventListener(classFilter, 'change', function() {
                if (window.CharacterList && typeof window.CharacterList.render === 'function') {
                    window.CharacterList.render();
                }
            });
        }

        var clearFilter = document.getElementById('clear-char-filter');
        if (clearFilter) {
            addSafeEventListener(clearFilter, 'click', function() {
                var nameEl = document.getElementById('char-name-filter');
                var statusEl = document.getElementById('char-status-filter');
                var classEl = document.getElementById('char-class-filter');

                if (nameEl) nameEl.value = '';
                if (statusEl) statusEl.value = 'all';
                if (classEl) classEl.value = 'all';

                if (window.CharacterList && typeof window.CharacterList.render === 'function') {
                    window.CharacterList.render();
                }
            });
        }
    }

    // ============================================================
    // CAREER STATUS - DOM-based with event delegation
    // ============================================================

    function bindCareerStatus(container) {
        var addStatusBtn = document.getElementById('add-status-btn');
        if (addStatusBtn) {
            addSafeEventListener(addStatusBtn, 'click', function() {
                var container = document.getElementById('career-status-container');
                if (window.CharacterViews && typeof window.CharacterViews.addCareerStatusEntry === 'function') {
                    window.CharacterViews.addCareerStatusEntry(container);
                }
            });
        }

        // Event delegation for remove status buttons
        var statusContainer = document.getElementById('career-status-container');
        if (statusContainer) {
            addSafeEventListener(statusContainer, 'click', function(e) {
                var target = e.target;
                if (target && target.classList.contains('remove-status')) {
                    var entry = target.closest('.career-status-entry');
                    var container = document.getElementById('career-status-container');
                    if (entry && container && container.children.length > 1) {
                        entry.remove();
                    } else if (entry && container) {
                        showNotification('You need at least one status entry.', 'error');
                    }
                }
            });
        }
    }

    // ============================================================
    // DECEASED TOGGLE
    // ============================================================

    function bindDeceasedToggle(container) {
        var deceasedCheck = document.getElementById('char-deceased');
        if (deceasedCheck) {
            addSafeEventListener(deceasedCheck, 'change', function() {
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

    function bindEliminationControls(container) {
        var addElimBtn = document.getElementById('add-standalone-elim-btn');
        if (addElimBtn) {
            addSafeEventListener(addElimBtn, 'click', function() {
                if (window.CharacterEliminations && typeof window.CharacterEliminations.addStandalone === 'function') {
                    window.CharacterEliminations.addStandalone();
                }
            });
        }

        // Event delegation for remove standalone elimination buttons
        var standaloneContainer = document.getElementById('standalone-eliminations-container');
        if (standaloneContainer) {
            addSafeEventListener(standaloneContainer, 'click', function(e) {
                var target = e.target;
                if (target && target.classList.contains('remove-standalone-elim')) {
                    var id = typeof window.currentEditId === 'function' ? window.currentEditId() : null;
                    var eliminationId = target.dataset.id;
                    if (id && eliminationId) {
                        if (window.CharacterEliminations && typeof window.CharacterEliminations.removeStandalone === 'function') {
                            window.CharacterEliminations.removeStandalone(id, eliminationId);
                        }
                    }
                }
            });
        }
    }

    // ============================================================
    // CLASS TAG INPUT
    // ============================================================

    function bindClassTagInput(container) {
        var classInput = document.getElementById('class-tag-input');
        if (classInput) {
            addSafeEventListener(classInput, 'keypress', function(e) {
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
                            showNotification(result ? result.message : 'Failed to create class.', 'error');
                            return;
                        }
                    }

                    var container = document.getElementById('class-tag-container');
                    if (container) {
                        var existing = container.querySelector('[data-class-id="' + cls.id + '"]');
                        if (existing) {
                            showNotification('This class is already assigned.', 'error');
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

        // Event delegation for remove class tag buttons
        var tagContainer = document.getElementById('class-tag-container');
        if (tagContainer) {
            addSafeEventListener(tagContainer, 'click', function(e) {
                var target = e.target;
                if (target && target.classList.contains('remove-class-tag')) {
                    var id = target.dataset.id;
                    var container = document.getElementById('class-tag-container');
                    var tag = container.querySelector('[data-class-id="' + id + '"]');
                    if (tag) tag.remove();
                    if (container && container.children.length === 0) {
                        container.innerHTML = '<span style="color:var(--text-dim);font-size:0.7rem;padding:4px;">No classes assigned</span>';
                    }
                }
            });
        }
    }

    // ============================================================
    // ACADEMIC CLASS CONTROLS
    // ============================================================

    function bindAcademicClassControls(container) {
        var addToClassBtn = document.getElementById('add-to-class-btn');
        if (addToClassBtn) {
            addSafeEventListener(addToClassBtn, 'click', function() {
                if (window.CharacterClasses && typeof window.CharacterClasses.addToClass === 'function') {
                    window.CharacterClasses.addToClass();
                }
            });
        }

        var removeFromClassBtn = document.getElementById('remove-from-class-btn');
        if (removeFromClassBtn) {
            addSafeEventListener(removeFromClassBtn, 'click', function() {
                if (window.CharacterClasses && typeof window.CharacterClasses.removeFromClass === 'function') {
                    window.CharacterClasses.removeFromClass();
                }
            });
        }
    }

    // ============================================================
    // SOCIAL BUTTON
    // ============================================================

    function bindSocialButton(container) {
        var socialBtn = document.getElementById('add-social-relation-btn');
        if (socialBtn) {
            addSafeEventListener(socialBtn, 'click', function() {
                var id = typeof window.currentEditId === 'function' ? window.currentEditId() : null;
                if (!id) {
                    showNotification('Please save the character first.', 'error');
                    return;
                }
                if (typeof window.showRelationshipForm === 'function') {
                    window.showRelationshipForm(null, id);
                } else {
                    showNotification('Relationship functionality is not available. Please use the Social tab.', 'error');
                }
            });
        }
    }

    // ============================================================
    // CLICK OUTSIDE - Close character list
    // ============================================================

    function bindClickOutside(container) {
        addSafeEventListener(document, 'click', function(e) {
            var panel = document.getElementById('char-list-panel');
            var toggle = document.getElementById('toggle-char-list');

            if (panel && panel.classList.contains('open')) {
                var clickedOutsidePanel = !panel.contains(e.target);
                var clickedToggle = toggle && toggle.contains(e.target);

                if (clickedOutsidePanel && !clickedToggle) {
                    toggleCharacterList(false);
                }
            }
        });
    }

    // ============================================================
    // STATS EVENTS
    // ============================================================

    function bindStatsEvents(container) {
        if (window.CharacterStats && typeof window.CharacterStats.initStatsEvents === 'function') {
            // Stats events are self-contained within CharacterStats
            window.CharacterStats.initStatsEvents();
        }

        // Additional stats events that need to interact with character state
        var statInputs = ['char-str', 'char-dex', 'char-con', 'char-int', 'char-wis', 'char-cha'];
        statInputs.forEach(function(id) {
            var el = document.getElementById(id);
            if (el) {
                // On change, update the class suggestion
                addSafeEventListener(el, 'change', function() {
                    if (window.CharacterStats && typeof window.CharacterStats.updateClassSuggestion === 'function') {
                        window.CharacterStats.updateClassSuggestion();
                    }
                });
                // On blur, sanitize and update
                addSafeEventListener(el, 'blur', function() {
                    var val = parseInt(this.value);
                    if (isNaN(val)) {
                        this.value = 10;
                    } else if (val < 1) {
                        this.value = 1;
                    } else if (val > 30) {
                        this.value = 30;
                    }
                    if (window.CharacterStats && typeof window.CharacterStats.updateClassSuggestion === 'function') {
                        window.CharacterStats.updateClassSuggestion();
                    }
                });
            }
        });

        // Manual class select
        var classSelect = document.getElementById('manual-class-select');
        if (classSelect) {
            // Populate the select with class options
            if (window.CharacterStats && typeof window.CharacterStats.populateClassSelect === 'function') {
                window.CharacterStats.populateClassSelect();
            }

            addSafeEventListener(classSelect, 'change', function() {
                var display = document.getElementById('suggested-class');
                var descDisplay = document.getElementById('class-description-display');
                var classes = window.CharacterStats && typeof window.CharacterStats.CLASS_DEFINITIONS !== 'undefined'
                    ? window.CharacterStats.CLASS_DEFINITIONS
                    : [];

                if (this.value) {
                    var selected = classes.find(function(c) { return c.id === this.value; }.bind(this));
                    if (selected) {
                        display.textContent = (selected.icon || '') + ' ' + (selected.label || '');
                        display.style.color = 'var(--accent)';
                        display.style.background = 'var(--accent-soft)';
                        display.style.borderColor = 'var(--accent)';
                        if (descDisplay) {
                            descDisplay.textContent = selected.description || 'No description available.';
                            descDisplay.style.borderLeftColor = 'var(--accent)';
                            descDisplay.style.color = 'var(--text)';
                        }
                    }
                } else {
                    if (window.CharacterStats && typeof window.CharacterStats.updateClassSuggestion === 'function') {
                        window.CharacterStats.updateClassSuggestion();
                    }
                    if (descDisplay) {
                        descDisplay.textContent = 'Select a class to see its description here.';
                        descDisplay.style.borderLeftColor = 'var(--accent)';
                        descDisplay.style.color = 'var(--text-dim)';
                    }
                }
            });
        }

        // Recalculate class button
        var recalcBtn = document.getElementById('recalculate-class-btn');
        if (recalcBtn) {
            addSafeEventListener(recalcBtn, 'click', function() {
                if (window.CharacterStats && typeof window.CharacterStats.updateClassSuggestion === 'function') {
                    window.CharacterStats.updateClassSuggestion();
                }
            });
        }

        // Random stats button
        var randomBtn = document.getElementById('random-stats-btn');
        if (randomBtn) {
            addSafeEventListener(randomBtn, 'click', function() {
                var stats = window.CharacterStats && typeof window.CharacterStats.generateRandomStats === 'function'
                    ? window.CharacterStats.generateRandomStats()
                    : { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 };

                var statKeys = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
                statKeys.forEach(function(key) {
                    var el = document.getElementById('char-' + key);
                    if (el) el.value = stats[key] || 10;
                });

                if (window.CharacterStats && typeof window.CharacterStats.updateClassSuggestion === 'function') {
                    window.CharacterStats.updateClassSuggestion();
                }
            });
        }
    }

    // ============================================================
    // MAGIC EVENTS
    // ============================================================

    function bindMagicEvents(container) {
        if (window.CharacterStats && typeof window.CharacterStats.initMagicEvents === 'function') {
            window.CharacterStats.initMagicEvents();
        }

        // Additional magic events
        var magicTypes = ['earth', 'water', 'fire', 'air', 'metal', 'wood',
            'blood', 'bone', 'mind', 'morphic', 'life', 'death',
            'space', 'time', 'dimension', 'void', 'reality', 'transference'];

        magicTypes.forEach(function(key) {
            var el = document.getElementById('magic-' + key);
            if (el) {
                addSafeEventListener(el, 'change', function() {
                    if (window.CharacterStats && typeof window.CharacterStats.updateMagicClassSuggestion === 'function') {
                        window.CharacterStats.updateMagicClassSuggestion();
                    }
                    if (window.CharacterStats && typeof window.CharacterStats.updateMagicPowerDisplay === 'function') {
                        window.CharacterStats.updateMagicPowerDisplay();
                    }
                });
                addSafeEventListener(el, 'blur', function() {
                    var val = parseInt(this.value);
                    var max = window.CharacterStats && typeof window.CharacterStats.MAGIC_MAX !== 'undefined'
                        ? window.CharacterStats.MAGIC_MAX
                        : 10;
                    if (isNaN(val)) {
                        this.value = 0;
                    } else if (val < 0) {
                        this.value = 0;
                    } else if (val > max) {
                        this.value = max;
                    }
                    if (window.CharacterStats && typeof window.CharacterStats.updateMagicClassSuggestion === 'function') {
                        window.CharacterStats.updateMagicClassSuggestion();
                    }
                    if (window.CharacterStats && typeof window.CharacterStats.updateMagicPowerDisplay === 'function') {
                        window.CharacterStats.updateMagicPowerDisplay();
                    }
                });
            }
        });

        // Magic class select
        var magicClassSelect = document.getElementById('manual-magic-class-select');
        if (magicClassSelect) {
            addSafeEventListener(magicClassSelect, 'change', function() {
                var display = document.getElementById('suggested-magic-class');
                if (this.value) {
                    var labels = {
                        'elementalist': 'Elementalist',
                        'body_mage': 'Body Mage',
                        'aether_mage': 'Aether Mage'
                    };
                    display.textContent = labels[this.value] || this.value;
                    display.style.color = 'var(--info)';
                    display.style.background = 'var(--info-soft)';
                    display.style.borderColor = 'var(--info)';
                } else {
                    if (window.CharacterStats && typeof window.CharacterStats.updateMagicClassSuggestion === 'function') {
                        window.CharacterStats.updateMagicClassSuggestion();
                    }
                }
            });
        }

        // Recalculate magic class button
        var recalcMagicBtn = document.getElementById('recalculate-magic-class-btn');
        if (recalcMagicBtn) {
            addSafeEventListener(recalcMagicBtn, 'click', function() {
                if (window.CharacterStats && typeof window.CharacterStats.updateMagicClassSuggestion === 'function') {
                    window.CharacterStats.updateMagicClassSuggestion();
                }
                if (window.CharacterStats && typeof window.CharacterStats.updateMagicPowerDisplay === 'function') {
                    window.CharacterStats.updateMagicPowerDisplay();
                }
            });
        }

        // Random category buttons
        var randomElementalBtn = document.getElementById('random-elemental-btn');
        if (randomElementalBtn) {
            addSafeEventListener(randomElementalBtn, 'click', function() {
                if (window.CharacterStats && typeof window.CharacterStats.generateRandomMagicCategory === 'function') {
                    var magic = window.CharacterStats.generateRandomMagicCategory('elemental');
                    var types = window.CharacterStats.getMagicCategoryTypes
                        ? window.CharacterStats.getMagicCategoryTypes('elemental')
                        : ['earth', 'water', 'fire', 'air', 'metal', 'wood'];
                    types.forEach(function(key) {
                        var input = document.getElementById('magic-' + key);
                        if (input && magic[key] !== undefined) {
                            input.value = magic[key];
                        }
                    });
                    if (window.CharacterStats && typeof window.CharacterStats.updateMagicClassSuggestion === 'function') {
                        window.CharacterStats.updateMagicClassSuggestion();
                    }
                    if (window.CharacterStats && typeof window.CharacterStats.updateMagicPowerDisplay === 'function') {
                        window.CharacterStats.updateMagicPowerDisplay();
                    }
                }
            });
        }

        var randomBodyBtn = document.getElementById('random-body-btn');
        if (randomBodyBtn) {
            addSafeEventListener(randomBodyBtn, 'click', function() {
                if (window.CharacterStats && typeof window.CharacterStats.generateRandomMagicCategory === 'function') {
                    var magic = window.CharacterStats.generateRandomMagicCategory('body');
                    var types = window.CharacterStats.getMagicCategoryTypes
                        ? window.CharacterStats.getMagicCategoryTypes('body')
                        : ['blood', 'bone', 'mind', 'morphic', 'life', 'death'];
                    types.forEach(function(key) {
                        var input = document.getElementById('magic-' + key);
                        if (input && magic[key] !== undefined) {
                            input.value = magic[key];
                        }
                    });
                    if (window.CharacterStats && typeof window.CharacterStats.updateMagicClassSuggestion === 'function') {
                        window.CharacterStats.updateMagicClassSuggestion();
                    }
                    if (window.CharacterStats && typeof window.CharacterStats.updateMagicPowerDisplay === 'function') {
                        window.CharacterStats.updateMagicPowerDisplay();
                    }
                }
            });
        }

        var randomAetherBtn = document.getElementById('random-aether-btn');
        if (randomAetherBtn) {
            addSafeEventListener(randomAetherBtn, 'click', function() {
                if (window.CharacterStats && typeof window.CharacterStats.generateRandomMagicCategory === 'function') {
                    var magic = window.CharacterStats.generateRandomMagicCategory('aether');
                    var types = window.CharacterStats.getMagicCategoryTypes
                        ? window.CharacterStats.getMagicCategoryTypes('aether')
                        : ['space', 'time', 'dimension', 'void', 'reality', 'transference'];
                    types.forEach(function(key) {
                        var input = document.getElementById('magic-' + key);
                        if (input && magic[key] !== undefined) {
                            input.value = magic[key];
                        }
                    });
                    if (window.CharacterStats && typeof window.CharacterStats.updateMagicClassSuggestion === 'function') {
                        window.CharacterStats.updateMagicClassSuggestion();
                    }
                    if (window.CharacterStats && typeof window.CharacterStats.updateMagicPowerDisplay === 'function') {
                        window.CharacterStats.updateMagicPowerDisplay();
                    }
                }
            });
        }
    }

    // ============================================================
    // SPECIAL MOVES EVENTS
    // ============================================================

    function bindSpecialMovesEvents(container) {
        if (window.CharacterStats && typeof window.CharacterStats.initSpecialMovesEvents === 'function') {
            window.CharacterStats.initSpecialMovesEvents();
        }

        // Add physical move button
        var addPhysicalBtn = document.getElementById('add-physical-move-btn');
        if (addPhysicalBtn) {
            addSafeEventListener(addPhysicalBtn, 'click', function() {
                var id = typeof window.currentEditId === 'function' ? window.currentEditId() : null;
                if (!id) {
                    showNotification('Please save the character first.', 'error');
                    return;
                }
                var char = typeof window.getCharacterById === 'function' ? window.getCharacterById(id) : null;
                if (!char) return;

                var name = document.getElementById('physical-move-name');
                var desc = document.getElementById('physical-move-desc');
                var moveName = name ? name.value.trim() : '';
                var moveDesc = desc ? desc.value.trim() : '';

                if (!moveName) {
                    showNotification('Please enter a move name.', 'error');
                    return;
                }

                if (window.CharacterStats && typeof window.CharacterStats.addSpecialMove === 'function') {
                    window.CharacterStats.addSpecialMove(char, 'physical', moveName, moveDesc);
                }

                var moves = window.CharacterStats && typeof window.CharacterStats.getSpecialMoves === 'function'
                    ? window.CharacterStats.getSpecialMoves(char)
                    : { physical: [], magical: [] };

                if (window.CharacterStats && typeof window.CharacterStats.renderSpecialMoves === 'function') {
                    window.CharacterStats.renderSpecialMoves('physical-moves-list', moves.physical || [], 'physical');
                }

                if (name) name.value = '';
                if (desc) desc.value = '';

                if (typeof window.saveData === 'function') {
                    window.saveData().catch(function(err) {
                        console.error('Failed to save physical move:', err);
                    });
                }
            });
        }

        // Add magical move button
        var addMagicalBtn = document.getElementById('add-magical-move-btn');
        if (addMagicalBtn) {
            addSafeEventListener(addMagicalBtn, 'click', function() {
                var id = typeof window.currentEditId === 'function' ? window.currentEditId() : null;
                if (!id) {
                    showNotification('Please save the character first.', 'error');
                    return;
                }
                var char = typeof window.getCharacterById === 'function' ? window.getCharacterById(id) : null;
                if (!char) return;

                var name = document.getElementById('magical-move-name');
                var desc = document.getElementById('magical-move-desc');
                var moveName = name ? name.value.trim() : '';
                var moveDesc = desc ? desc.value.trim() : '';

                if (!moveName) {
                    showNotification('Please enter a move name.', 'error');
                    return;
                }

                if (window.CharacterStats && typeof window.CharacterStats.addSpecialMove === 'function') {
                    window.CharacterStats.addSpecialMove(char, 'magical', moveName, moveDesc);
                }

                var moves = window.CharacterStats && typeof window.CharacterStats.getSpecialMoves === 'function'
                    ? window.CharacterStats.getSpecialMoves(char)
                    : { physical: [], magical: [] };

                if (window.CharacterStats && typeof window.CharacterStats.renderSpecialMoves === 'function') {
                    window.CharacterStats.renderSpecialMoves('magical-moves-list', moves.magical || [], 'magical');
                }

                if (name) name.value = '';
                if (desc) desc.value = '';

                if (typeof window.saveData === 'function') {
                    window.saveData().catch(function(err) {
                        console.error('Failed to save magical move:', err);
                    });
                }
            });
        }

        // Event delegation for remove special move buttons
        var physicalList = document.getElementById('physical-moves-list');
        if (physicalList) {
            addSafeEventListener(physicalList, 'click', function(e) {
                var target = e.target;
                if (target && target.classList.contains('remove-special-move')) {
                    var id = typeof window.currentEditId === 'function' ? window.currentEditId() : null;
                    if (!id) return;
                    var char = typeof window.getCharacterById === 'function' ? window.getCharacterById(id) : null;
                    if (!char) return;
                    var type = target.dataset.type || 'physical';
                    var index = parseInt(target.dataset.index);
                    if (!isNaN(index)) {
                        if (window.CharacterStats && typeof window.CharacterStats.removeSpecialMove === 'function') {
                            window.CharacterStats.removeSpecialMove(char, type, index);
                        }
                        var moves = window.CharacterStats && typeof window.CharacterStats.getSpecialMoves === 'function'
                            ? window.CharacterStats.getSpecialMoves(char)
                            : { physical: [], magical: [] };
                        if (window.CharacterStats && typeof window.CharacterStats.renderSpecialMoves === 'function') {
                            window.CharacterStats.renderSpecialMoves('physical-moves-list', moves.physical || [], 'physical');
                            window.CharacterStats.renderSpecialMoves('magical-moves-list', moves.magical || [], 'magical');
                        }
                        if (typeof window.saveData === 'function') {
                            window.saveData().catch(function(err) {
                                console.error('Failed to save special move removal:', err);
                            });
                        }
                    }
                }
            });
        }

        var magicalList = document.getElementById('magical-moves-list');
        if (magicalList) {
            addSafeEventListener(magicalList, 'click', function(e) {
                var target = e.target;
                if (target && target.classList.contains('remove-special-move')) {
                    var id = typeof window.currentEditId === 'function' ? window.currentEditId() : null;
                    if (!id) return;
                    var char = typeof window.getCharacterById === 'function' ? window.getCharacterById(id) : null;
                    if (!char) return;
                    var type = target.dataset.type || 'magical';
                    var index = parseInt(target.dataset.index);
                    if (!isNaN(index)) {
                        if (window.CharacterStats && typeof window.CharacterStats.removeSpecialMove === 'function') {
                            window.CharacterStats.removeSpecialMove(char, type, index);
                        }
                        var moves = window.CharacterStats && typeof window.CharacterStats.getSpecialMoves === 'function'
                            ? window.CharacterStats.getSpecialMoves(char)
                            : { physical: [], magical: [] };
                        if (window.CharacterStats && typeof window.CharacterStats.renderSpecialMoves === 'function') {
                            window.CharacterStats.renderSpecialMoves('physical-moves-list', moves.physical || [], 'physical');
                            window.CharacterStats.renderSpecialMoves('magical-moves-list', moves.magical || [], 'magical');
                        }
                        if (typeof window.saveData === 'function') {
                            window.saveData().catch(function(err) {
                                console.error('Failed to save special move removal:', err);
                            });
                        }
                    }
                }
            });
        }
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.CharacterEvents = {
        init: init,
        toggleCharacterList: toggleCharacterList,
        removeAllEventListeners: removeAllEventListeners
    };

})();
