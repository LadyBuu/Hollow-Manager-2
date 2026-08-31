/**
 * js/modules/characters/character-events.js - Character Events
 * Path: js/modules/characters/character-events.js
 * 
 * This module is responsible for UI event binding for the character module.
 * Feature-specific internal events may be delegated to their owning feature module.
 * 
 * IMPORTANT:
 *   - This module binds events AFTER the DOM is rendered
 *   - Uses event delegation where possible for dynamic elements
 *   - All mutations delegate to the appropriate module (CharacterCRUD, CharacterClasses, etc.)
 *   - Safe event binding with proper cleanup
 *   - No inline event handlers in HTML
 *   - Can be re-initialized after DOM replacement
 *   - Mutation modules own their own persistence lifecycle
 *   - No direct mutation of window.data
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
 *   - window.CharacterStats (owns magic schema definitions)
 *   - window.CharacterViews
 *   - window.getCharacterById (from core-utils.js)
 *   - window.getDisplayName (from core-utils.js)
 *   - window.getCurrentEditId (from index.js)
 *   - window.setCurrentEditId (from index.js)
 *   - window.showCharacterForm (from index.js)
 *   - window.toggleCharacterList (from index.js)
 *   - window.UI_CONSTANTS (from constants.js)
 *   - window.MAGIC_CONSTANTS (from constants.js)
 *   - window.NotificationSystem (from notification.js)
 * 
 * NOTE: CharacterStats owns magic schema definitions. This module
 *       consumes them rather than duplicating them.
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
    var _filterDebounceTimer = null;
    var _mutationInProgress = false;

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

        // Feature modules - required for their respective features
        var featureModules = {
            'CharacterCRUD': ['save'],
            'CharacterClasses': [
                'addClassByName',
                'removeClassById',
                'addToClass',
                'removeFromClass'
            ],
            'CharacterEliminations': ['addStandalone', 'removeStandalone'],
            'CharacterStats': [
                'addSpecialMove',
                'removeSpecialMove',
                'updateClassSuggestion',
                'updateMagicClassSuggestion',
                'updateMagicPowerDisplay',
                'generateRandomStats',
                'generateRandomMagicCategory',
                'getMagicTypeKeys',
                'populateClassSelect',
                'applyPhysicalClass',
                'applyMagicClass'
            ]
        };

        var missingFeatures = [];
        for (var moduleName in featureModules) {
            if (typeof window[moduleName] === 'undefined' || window[moduleName] === null) {
                missingFeatures.push(moduleName + ' (module missing)');
                continue;
            }
            var methods = featureModules[moduleName];
            for (var i = 0; i < methods.length; i++) {
                if (typeof window[moduleName][methods[i]] !== 'function') {
                    missingFeatures.push(moduleName + '.' + methods[i]);
                }
            }
        }

        if (missing.length > 0) {
            console.warn('CharacterEvents: Missing required dependencies:', missing.join(', '));
            return false;
        }

        if (missingFeatures.length > 0) {
            console.warn('CharacterEvents: Missing feature dependencies:', missingFeatures.join(', '));
        }

        return true;
    }

    // ============================================================
    // MAGIC TYPE HELPERS - Delegate to CharacterStats or Constants
    // ============================================================

    function getMagicTypeKeys() {
        if (window.CharacterStats &&
            typeof window.CharacterStats.getMagicTypeKeys === 'function') {
            return window.CharacterStats.getMagicTypeKeys();
        }
        return window.MAGIC_CONSTANTS.TYPES.slice();
    }

    function getMagicCategoryTypes(category) {
        if (window.CharacterStats &&
            typeof window.CharacterStats.getMagicCategoryTypes === 'function') {
            return window.CharacterStats.getMagicCategoryTypes(category);
        }
        return window.MAGIC_CONSTANTS.CATEGORIES[category] 
            ? window.MAGIC_CONSTANTS.CATEGORIES[category].types.slice()
            : [];
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

        clearTimeout(_filterDebounceTimer);
        _filterDebounceTimer = null;
    }

    // ============================================================
    // NOTIFICATION
    // ============================================================

    function showNotification(message, type) {
        type = type || 'info';

        if (window.NotificationSystem && typeof window.NotificationSystem.notify === 'function') {
            window.NotificationSystem.notify(message, type);
            return;
        }

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
        _mutationInProgress = false;
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
                if (window.innerWidth < window.UI_CONSTANTS.MOBILE_BREAKPOINT && typeof window.toggleCharacterList === 'function') {
                    window.toggleCharacterList(false);
                }
            });
        }
    }

    // ============================================================
    // FORM SUBMIT
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
    // FILTERS - With single debounce timer
    // ============================================================

    function bindFilters(container) {
        var nameFilter = document.getElementById('char-name-filter');
        if (nameFilter) {
            addSafeEventListener(nameFilter, 'input', function() {
                clearTimeout(_filterDebounceTimer);
                _filterDebounceTimer = setTimeout(function() {
                    if (window.CharacterList && typeof window.CharacterList.render === 'function') {
                        window.CharacterList.render();
                    }
                }, window.UI_CONSTANTS.DEBOUNCE_DELAY);
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
                var statusContainer = document.getElementById('career-status-container');
                if (window.CharacterViews && typeof window.CharacterViews.addCareerStatusEntry === 'function') {
                    window.CharacterViews.addCareerStatusEntry(statusContainer);
                }
            });
        }

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
    // CLASS TAG INPUT - Add class by name with feedback
    // ============================================================

    function bindClassTagInput(container) {
        var classInput = document.getElementById('class-tag-input');
        if (classInput) {
            addSafeEventListener(classInput, 'keydown', function(e) {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    var name = this.value.trim();
                    if (!name) return;

                    if (window.CharacterClasses && typeof window.CharacterClasses.addClassByName === 'function') {
                        var result = window.CharacterClasses.addClassByName(name);
                        if (result && typeof result.then === 'function') {
                            result.then(function(success) {
                                if (success && classInput) {
                                    classInput.value = '';
                                }
                            }).catch(function() {
                                // Don't clear on failure - user can retry
                            });
                        } else {
                            if (classInput) classInput.value = '';
                        }
                    } else {
                        showNotification('Class functionality is not available.', 'error');
                    }
                }
            });
        }
    }

    // ============================================================
    // CLASS TAG REMOVAL - Delegate to CharacterClasses
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

                if (window.CharacterClasses && typeof window.CharacterClasses.removeClassById === 'function') {
                    window.CharacterClasses.removeClassById(charId, classId);
                } else {
                    showNotification('Character class functionality is not available.', 'error');
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
    // CHARACTER LIST - Event delegation
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

            if (window.innerWidth < window.UI_CONSTANTS.MOBILE_BREAKPOINT && typeof window.toggleCharacterList === 'function') {
                window.toggleCharacterList(false);
            }
        });
    }

    // ============================================================
    // STATS EVENTS - Delegate to CharacterStats for calculations
    // ============================================================

    function bindStatsEvents(container) {
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
                        this.value = window.STATS_CONSTANTS.DEFAULT;
                    } else if (val < window.STATS_CONSTANTS.MIN) {
                        this.value = window.STATS_CONSTANTS.MIN;
                    } else if (val > window.STATS_CONSTANTS.MAX) {
                        this.value = window.STATS_CONSTANTS.MAX;
                    }
                    if (window.CharacterStats && typeof window.CharacterStats.updateClassSuggestion === 'function') {
                        window.CharacterStats.updateClassSuggestion();
                    }
                });
            }
        });

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
                    if (selected && display) {
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

        // Apply Physical Class button
        var applyClassBtn = document.getElementById('apply-class-btn');
        if (applyClassBtn) {
            addSafeEventListener(applyClassBtn, 'click', function() {
                if (window.CharacterStats && typeof window.CharacterStats.applyPhysicalClass === 'function') {
                    window.CharacterStats.applyPhysicalClass();
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
    // MAGIC EVENTS - Delegate to CharacterStats
    // ============================================================

    function bindMagicEvents(container) {
        var magicTypes = getMagicTypeKeys();

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
                        : window.MAGIC_CONSTANTS.MAX;
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
                if (this.value && display) {
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

        // Apply Magic Class button
        var applyMagicClassBtn = document.getElementById('apply-magic-class-btn');
        if (applyMagicClassBtn) {
            addSafeEventListener(applyMagicClassBtn, 'click', function() {
                if (window.CharacterStats && typeof window.CharacterStats.applyMagicClass === 'function') {
                    window.CharacterStats.applyMagicClass();
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

        var randomElementalBtn = document.getElementById('random-elemental-btn');
        if (randomElementalBtn) {
            addSafeEventListener(randomElementalBtn, 'click', function() {
                if (window.CharacterStats && typeof window.CharacterStats.generateRandomMagicCategory === 'function') {
                    var magic = window.CharacterStats.generateRandomMagicCategory('elemental');
                    var types = getMagicCategoryTypes('elemental');
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
                    var types = getMagicCategoryTypes('body');
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
                    var types = getMagicCategoryTypes('aether');
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
    // SPECIAL MOVES EVENTS - Delegate to CharacterStats
    // ============================================================

    function bindSpecialMovesEvents(container) {
        var addPhysicalBtn = document.getElementById('add-physical-move-btn');
        if (addPhysicalBtn) {
            addSafeEventListener(addPhysicalBtn, 'click', function() {
                handleAddSpecialMove('physical');
            });
        }

        var addMagicalBtn = document.getElementById('add-magical-move-btn');
        if (addMagicalBtn) {
            addSafeEventListener(addMagicalBtn, 'click', function() {
                handleAddSpecialMove('magical');
            });
        }

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
    // SPECIAL MOVES - Shared Handlers with Promise support
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

        if (window.CharacterStats && typeof window.CharacterStats.addSpecialMove === 'function') {
            var result = window.CharacterStats.addSpecialMove(char, type, moveName, moveDesc);

            if (result && typeof result.then === 'function') {
                result.then(function(success) {
                    if (success !== false) {
                        if (nameInput) nameInput.value = '';
                        if (descInput) descInput.value = '';
                    }
                }).catch(function() {
                    // Don't clear on failure - user can retry
                });
            } else if (result !== false) {
                if (nameInput) nameInput.value = '';
                if (descInput) descInput.value = '';
            }
        } else {
            showNotification('Special move functionality is not available.', 'error');
            return;
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

        if (window.CharacterStats && typeof window.CharacterStats.removeSpecialMove === 'function') {
            window.CharacterStats.removeSpecialMove(char, type, index);
        } else {
            showNotification('Special move functionality is not available.', 'error');
            return;
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
