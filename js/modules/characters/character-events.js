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
 *   - Can be re-initialized after DOM replacement
 * 
 * LIFECYCLE:
 *   - init(container) - Binds events to the current DOM
 *   - destroy() - Removes all event listeners and resets state
 *   - Re-initialization is supported for dynamic DOM replacement
 * 
 * DEPENDENCIES:
 *   - window.CharacterCRUD
 *   - window.CharacterClasses
 *   - window.CharacterEliminations
 *   - window.CharacterStats
 *   - window.CharacterViews
 *   - window.getCharacterById (from core-utils.js)
 *   - window.getDisplayName (from core-utils.js)
 *   - window.getCurrentEditId (from index.js)
 *   - window.setCurrentEditId (from index.js)
 *   - window.showCharacterForm (from index.js)
 *   - window.toggleCharacterList (from index.js)
 *   - window.saveData (from database.js)
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

    var _initialized = false;
    var _eventListeners = [];
    var _debounceTimers = [];

    // ============================================================
    // DEPENDENCY CHECK
    // ============================================================

    function checkDependencies() {
        var required = [
            'getCharacterById',
            'getDisplayName',
            'getCurrentEditId',
            'setCurrentEditId',
            'showCharacterForm',
            'toggleCharacterList'
        ];

        var missing = [];
        required.forEach(function(name) {
            if (typeof window[name] !== 'function') {
                missing.push(name);
            }
        });

        // Optional but recommended
        var optional = ['saveData', 'CharacterCRUD', 'CharacterClasses', 
                       'CharacterEliminations', 'CharacterStats', 'CharacterViews'];

        var missingOptional = [];
        optional.forEach(function(name) {
            if (typeof window[name] === 'undefined' || 
                (typeof window[name] === 'object' && window[name] === null)) {
                missingOptional.push(name);
            }
        });

        if (missing.length > 0) {
            console.warn('CharacterEvents: Missing required dependencies:', missing.join(', '));
            return false;
        }

        if (missingOptional.length > 0) {
            console.warn('CharacterEvents: Missing optional dependencies:', missingOptional.join(', '));
            // Don't fail - some features may be degraded
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

        // Clear any pending debounce timers
        _debounceTimers.forEach(function(timer) {
            clearTimeout(timer);
        });
        _debounceTimers = [];
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
    // MAIN INITIALIZATION - Supports re-initialization
    // ============================================================

    function init(container) {
        if (!checkDependencies()) {
            console.warn('CharacterEvents: Dependencies not met, skipping initialization');
            return;
        }

        if (!container) {
            container = document.getElementById('tab-characters');
        }
        if (!container) {
            console.warn('CharacterEvents: Container not found');
            return;
        }

        // Remove existing listeners before binding new ones
        removeAllEventListeners();

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
        bindClassTagRemoval(container);
        bindAcademicClassControls(container);
        bindSocialButton(container);
        bindClickOutside(container);
        bindCharacterList(container);
        bindStatsEvents(container);
        bindMagicEvents(container);
        bindSpecialMovesEvents(container);

        _initialized = true;
    }

    // ============================================================
    // DESTROY - Clean up for re-initialization
    // ============================================================

    function destroy() {
        removeAllEventListeners();
        _initialized = false;
    }

    // ============================================================
    // TOGGLE CHARACTER LIST
    // ============================================================

    function bindToggleList(container) {
        var toggleBtn = document.getElementById('toggle-char-list');
        if (toggleBtn) {
            addSafeEventListener(toggleBtn, 'click', function(e) {
                e.stopPropagation();
                if (typeof window.toggleCharacterList === 'function') {
                    window.toggleCharacterList();
                }
            });
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
                if (window.innerWidth < 768 && typeof window.toggleCharacterList === 'function') {
                    window.toggleCharacterList(false);
                }
            });
        }
    }

    // ============================================================
    // FORM SUBMIT - Fixed ID
    // ============================================================

    function bindFormSubmit(container) {
        var form = document.getElementById('character-form');
        if (form) {
            addSafeEventListener(form, 'submit', function(e) {
                e.preventDefault();
                if (window.CharacterCRUD && typeof window.CharacterCRUD.save === 'function') {
                    window.CharacterCRUD.save();
                }
            });
        } else {
            console.warn('CharacterEvents: Form #character-form not found');
        }
    }

    // ============================================================
    // DELETE BUTTON
    // ============================================================

    function bindDeleteButton(container) {
        var deleteBtn = document.getElementById('delete-char-btn');
        if (deleteBtn) {
            addSafeEventListener(deleteBtn, 'click', function() {
                var id = typeof window.getCurrentEditId === 'function' ? window.getCurrentEditId() : null;
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
            var debounceTimer = null;
            addSafeEventListener(nameFilter, 'input', function() {
                clearTimeout(debounceTimer);
                debounceTimer = setTimeout(function() {
                    if (window.CharacterList && typeof window.CharacterList.render === 'function') {
                        window.CharacterList.render();
                    }
                }, 300);
                _debounceTimers.push(debounceTimer);
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
                var target = e.target.closest ? e.target.closest('.remove-status') : null;
                if (!target) return;
                if (!statusContainer.contains(target)) return;

                var entry = target.closest('.career-status-entry');
                if (entry && statusContainer.children.length > 1) {
                    entry.remove();
                } else if (entry) {
                    showNotification('You need at least one status entry.', 'error');
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
                var target = e.target.closest ? e.target.closest('.remove-standalone-elim') : null;
                if (!target) return;
                if (!standaloneContainer.contains(target)) return;

                var id = typeof window.getCurrentEditId === 'function' ? window.getCurrentEditId() : null;
                var eliminationId = target.dataset.id;
                if (id && eliminationId) {
                    if (window.CharacterEliminations && typeof window.CharacterEliminations.removeStandalone === 'function') {
                        window.CharacterEliminations.removeStandalone(id, eliminationId);
                    }
                }
            });
        }
    }

    // ============================================================
    // CLASS TAG INPUT - Add class by name
    // ============================================================

    function bindClassTagInput(container) {
        var classInput = document.getElementById('class-tag-input');
        if (classInput) {
            addSafeEventListener(classInput, 'keypress', function(e) {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    var name = this.value.trim();
                    if (!name) return;

                    // Delegate to CharacterClasses to handle class lookup/creation
                    if (window.CharacterClasses && typeof window.CharacterClasses.addClassByName === 'function') {
                        window.CharacterClasses.addClassByName(name);
                    } else {
                        // Fallback: direct class creation
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
                }
            });
        }
    }

    // ============================================================
    // CLASS TAG REMOVAL - Proper mutation through CharacterClasses
    // ============================================================

    function bindClassTagRemoval(container) {
        var tagContainer = document.getElementById('class-tag-container');
        if (tagContainer) {
            addSafeEventListener(tagContainer, 'click', function(e) {
                var target = e.target.closest ? e.target.closest('.remove-class-tag') : null;
                if (!target) return;
                if (!tagContainer.contains(target)) return;

                var classId = target.dataset.id;
                if (!classId) return;

                var charId = typeof window.getCurrentEditId === 'function' ? window.getCurrentEditId() : null;
                if (!charId) {
                    showNotification('No character selected.', 'error');
                    return;
                }

                // Delegate to CharacterClasses for proper mutation
                if (window.CharacterClasses && typeof window.CharacterClasses.removeClassById === 'function') {
                    window.CharacterClasses.removeClassById(charId, classId);
                } else {
                    // Fallback: just remove the tag from DOM (less ideal)
                    var tag = tagContainer.querySelector('[data-class-id="' + classId + '"]');
                    if (tag) tag.remove();
                    if (tagContainer.children.length === 0) {
                        tagContainer.innerHTML = '<span style="color:var(--text-dim);font-size:0.7rem;padding:4px;">No classes assigned</span>';
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
                var id = typeof window.getCurrentEditId === 'function' ? window.getCurrentEditId() : null;
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
                    if (typeof window.toggleCharacterList === 'function') {
                        window.toggleCharacterList(false);
                    }
                }
            }
        });
    }

    // ============================================================
    // CHARACTER LIST - Event delegation (moved from character-list.js)
    // ============================================================

    function bindCharacterList(container) {
        var listContainer = document.getElementById('characters-container');
        if (!listContainer) return;

        addSafeEventListener(listContainer, 'click', function(e) {
            var item = e.target.closest ? e.target.closest('.char-list-item') : null;
            if (!item) return;
            if (!listContainer.contains(item)) return;

            var id = item.dataset.id;
            if (!id) return;

            if (typeof window.showCharacterForm === 'function') {
                window.showCharacterForm(id);
            }

            // Close list on mobile
            if (window.innerWidth < 768 && typeof window.toggleCharacterList === 'function') {
                window.toggleCharacterList(false);
            }
        });
    }

    // ============================================================
    // STATS EVENTS
    // ============================================================

    function bindStatsEvents(container) {
        // Let CharacterStats own its internal event binding
        if (window.CharacterStats && typeof window.CharacterStats.initStatsEvents === 'function') {
            window.CharacterStats.initStatsEvents();
        }

        // Additional stats events that need to interact with character state
        var statInputs = ['char-str', 'char-dex', 'char-con', 'char-int', 'char-wis', 'char-cha'];
        statInputs.forEach(function(id) {
            var el = document.getElementById(id);
            if (el) {
                addSafeEventListener(el, 'change', function() {
                    if (window.CharacterStats && typeof window.CharacterStats.updateClassSuggestion === 'function') {
                        window.CharacterStats.updateClassSuggestion();
                    }
                });
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
            if (window.CharacterStats && typeof window.CharacterStats.populateClassSelect === 'function') {
                window.CharacterStats.populateClassSelect();
            }

            addSafeEventListener(classSelect, 'change', function() {
                var display = document.getElementById('suggested-class');
                var descDisplay = document.getElementById('class-description-display');

                if (this.value) {
                    var classes = window.CharacterStats && typeof window.CharacterStats.CLASS_DEFINITIONS !== 'undefined'
                        ? window.CharacterStats.CLASS_DEFINITIONS
                        : [];
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

        var recalcBtn = document.getElementById('recalculate-class-btn');
        if (recalcBtn) {
            addSafeEventListener(recalcBtn, 'click', function() {
                if (window.CharacterStats && typeof window.CharacterStats.updateClassSuggestion === 'function') {
                    window.CharacterStats.updateClassSuggestion();
                }
            });
        }

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
        // Let CharacterStats own its internal magic event binding
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
    // SPECIAL MOVES EVENTS - DRY with shared handler
    // ============================================================

    function bindSpecialMovesEvents(container) {
        // Let CharacterStats own its internal special moves event binding
        if (window.CharacterStats && typeof window.CharacterStats.initSpecialMovesEvents === 'function') {
            window.CharacterStats.initSpecialMovesEvents();
        }

        // Add physical move button
        var addPhysicalBtn = document.getElementById('add-physical-move-btn');
        if (addPhysicalBtn) {
            addSafeEventListener(addPhysicalBtn, 'click', function() {
                handleAddSpecialMove('physical');
            });
        }

        // Add magical move button
        var addMagicalBtn = document.getElementById('add-magical-move-btn');
        if (addMagicalBtn) {
            addSafeEventListener(addMagicalBtn, 'click', function() {
                handleAddSpecialMove('magical');
            });
        }

        // Shared event delegation for remove special move buttons
        var physicalList = document.getElementById('physical-moves-list');
        if (physicalList) {
            addSafeEventListener(physicalList, 'click', function(e) {
                handleRemoveSpecialMove(e, 'physical');
            });
        }

        var magicalList = document.getElementById('magical-moves-list');
        if (magicalList) {
            addSafeEventListener(magicalList, 'click', function(e) {
                handleRemoveSpecialMove(e, 'magical');
            });
        }
    }

    // ============================================================
    // SPECIAL MOVES - Shared Handlers
    // ============================================================

    function handleAddSpecialMove(type) {
        var id = typeof window.getCurrentEditId === 'function' ? window.getCurrentEditId() : null;
        if (!id) {
            showNotification('Please save the character first.', 'error');
            return;
        }

        var char = typeof window.getCharacterById === 'function' ? window.getCharacterById(id) : null;
        if (!char) return;

        var nameInput = document.getElementById(type + '-move-name');
        var descInput = document.getElementById(type + '-move-desc');

        var moveName = nameInput ? nameInput.value.trim() : '';
        var moveDesc = descInput ? descInput.value.trim() : '';

        if (!moveName) {
            showNotification('Please enter a move name.', 'error');
            return;
        }

        // Mutate through CharacterStats
        if (window.CharacterStats && typeof window.CharacterStats.addSpecialMove === 'function') {
            window.CharacterStats.addSpecialMove(char, type, moveName, moveDesc);
        }

        // Re-render moves
        var moves = window.CharacterStats && typeof window.CharacterStats.getSpecialMoves === 'function'
            ? window.CharacterStats.getSpecialMoves(char)
            : { physical: [], magical: [] };

        if (window.CharacterStats && typeof window.CharacterStats.renderSpecialMoves === 'function') {
            window.CharacterStats.renderSpecialMoves('physical-moves-list', moves.physical || [], 'physical');
            window.CharacterStats.renderSpecialMoves('magical-moves-list', moves.magical || [], 'magical');
        }

        // Clear inputs
        if (nameInput) nameInput.value = '';
        if (descInput) descInput.value = '';

        // Save - CharacterStats should ideally own this, but for now we save here
        if (typeof window.saveData === 'function') {
            window.saveData().catch(function(err) {
                console.error('Failed to save ' + type + ' move:', err);
            });
        }
    }

    function handleRemoveSpecialMove(e, defaultType) {
        var target = e.target.closest ? e.target.closest('.remove-special-move') : null;
        if (!target) return;

        var container = target.closest('.moves-list');
        if (!container) return;

        var id = typeof window.getCurrentEditId === 'function' ? window.getCurrentEditId() : null;
        if (!id) {
            showNotification('Please save the character first.', 'error');
            return;
        }

        var char = typeof window.getCharacterById === 'function' ? window.getCharacterById(id) : null;
        if (!char) return;

        var type = target.dataset.type || defaultType || 'physical';
        var index = parseInt(target.dataset.index);
        if (isNaN(index)) return;

        // Mutate through CharacterStats
        if (window.CharacterStats && typeof window.CharacterStats.removeSpecialMove === 'function') {
            window.CharacterStats.removeSpecialMove(char, type, index);
        }

        // Re-render moves
        var moves = window.CharacterStats && typeof window.CharacterStats.getSpecialMoves === 'function'
            ? window.CharacterStats.getSpecialMoves(char)
            : { physical: [], magical: [] };

        if (window.CharacterStats && typeof window.CharacterStats.renderSpecialMoves === 'function') {
            window.CharacterStats.renderSpecialMoves('physical-moves-list', moves.physical || [], 'physical');
            window.CharacterStats.renderSpecialMoves('magical-moves-list', moves.magical || [], 'magical');
        }

        // Save - CharacterStats should ideally own this, but for now we save here
        if (typeof window.saveData === 'function') {
            window.saveData().catch(function(err) {
                console.error('Failed to save special move removal:', err);
            });
        }
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.CharacterEvents = {
        init: init,
        destroy: destroy,
        removeAllEventListeners: removeAllEventListeners
    };

})();
