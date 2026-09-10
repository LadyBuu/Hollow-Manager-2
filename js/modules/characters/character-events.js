/**
 * js/modules/characters/character-events.js - Character Events
 * Path: js/modules/characters/character-events.js
 * 
 * This module is responsible for UI event orchestration for the character module.
 * 
 * IMPORTANT:
 *   - ORCHESTRATION ONLY - no domain logic, no direct mutations
 *   - All mutations delegate to the appropriate module (CharacterCRUD, CharacterClasses, etc.)
 *   - Uses CharacterAggregator for cross-domain projections
 *   - Uses CharacterQueries for simple character reads
 *   - Uses CharacterForm.collect() to get form data
 *   - Uses CharacterCRUD for save/delete operations
 *   - Uses CharacterClassView for class rendering
 *   - Uses CharacterEliminationView for elimination rendering
 *   - Uses FormUtils for form field operations
 *   - Uses NotificationSystem for notifications
 *   - Safe event binding with proper cleanup
 *   - Can be re-initialized after DOM replacement
 *   - No inline event handlers in HTML
 *   - No direct mutation of window.data
 *   - No direct DOM manipulation (delegates to views)
 * 
 * LIFECYCLE:
 *   - init(container) - Binds events to the current DOM
 *   - destroy() - Removes all event listeners and resets state
 *   - Re-initialization is supported for dynamic DOM replacement
 * 
 * DEPENDENCIES (ALL MANDATORY):
 *   - window.CharacterAggregator (from character-aggregator.js)
 *   - window.CharacterQueries (from character-queries.js)
 *   - window.CharacterCRUD (from character-crud.js)
 *   - window.CharacterForm (from character-form.js)
 *   - window.CharacterClassView (from character-class-view.js)
 *   - window.CharacterEliminationView (from character-elimination-view.js)
 *   - window.CharacterGenerator (from character-generator.js)
 *   - window.CharacterClasses (from character-classes.js)
 *   - window.FormUtils (from form-utils.js)
 *   - window.NotificationSystem (from notification.js)
 *   - window.getCurrentEditId (from index.js)
 *   - window.setCurrentEditId (from index.js)
 *   - window.toggleCharacterList (from index.js)
 *   - window.UI_CONSTANTS (from constants.js)
 */

(function() {
    'use strict';

    if (window.__characterEventsLoaded) {
        return;
    }
    window.__characterEventsLoaded = true;

    // ============================================================
    // DEPENDENCY IMPORTS - MANDATORY (no fallbacks)
    // ============================================================

    var CharacterAggregator = window.CharacterAggregator;
    var CharacterQueries = window.CharacterQueries;
    var CharacterCRUD = window.CharacterCRUD;
    var CharacterForm = window.CharacterForm;
    var CharacterClassView = window.CharacterClassView;
    var CharacterEliminationView = window.CharacterEliminationView;
    var CharacterGenerator = window.CharacterGenerator;
    var CharacterClasses = window.CharacterClasses;
    var FormUtils = window.FormUtils;
    var NotificationSystem = window.NotificationSystem;
    var UI_CONSTANTS = window.UI_CONSTANTS;

    // ============================================================
    // STATE
    // ============================================================

    var _initialized = false;
    var _eventListeners = [];
    var _filterDebounceTimer = null;

    // ============================================================
    // DEPENDENCY CHECK - All dependencies mandatory
    // ============================================================

    function checkDependencies() {
        var missing = [];

        // Required functions from index.js
        var required = [
            'getCurrentEditId',
            'setCurrentEditId',
            'toggleCharacterList'
        ];

        required.forEach(function(name) {
            if (typeof window[name] !== 'function') {
                missing.push(name);
            }
        });

        // Mandatory modules
        if (!CharacterAggregator || typeof CharacterAggregator.getCharacterDetail !== 'function') {
            missing.push('CharacterAggregator.getCharacterDetail');
        }
        if (!CharacterAggregator || typeof CharacterAggregator.getCharacterListViewModel !== 'function') {
            missing.push('CharacterAggregator.getCharacterListViewModel');
        }

        if (!CharacterQueries || typeof CharacterQueries.getCharacterById !== 'function') {
            missing.push('CharacterQueries.getCharacterById');
        }
        if (!CharacterQueries || typeof CharacterQueries.getDisplayName !== 'function') {
            missing.push('CharacterQueries.getDisplayName');
        }

        if (!CharacterCRUD || typeof CharacterCRUD.save !== 'function') {
            missing.push('CharacterCRUD.save');
        }
        if (!CharacterCRUD || typeof CharacterCRUD.delete !== 'function') {
            missing.push('CharacterCRUD.delete');
        }

        if (!CharacterForm || typeof CharacterForm.render !== 'function') {
            missing.push('CharacterForm.render');
        }
        if (!CharacterForm || typeof CharacterForm.collect !== 'function') {
            missing.push('CharacterForm.collect');
        }

        if (!CharacterClassView || typeof CharacterClassView.renderClassTags !== 'function') {
            missing.push('CharacterClassView.renderClassTags');
        }
        if (!CharacterClassView || typeof CharacterClassView.populateClassSelector !== 'function') {
            missing.push('CharacterClassView.populateClassSelector');
        }

        if (!CharacterEliminationView || typeof CharacterEliminationView.renderTournamentEliminations !== 'function') {
            missing.push('CharacterEliminationView.renderTournamentEliminations');
        }
        if (!CharacterEliminationView || typeof CharacterEliminationView.renderStandaloneEliminations !== 'function') {
            missing.push('CharacterEliminationView.renderStandaloneEliminations');
        }

        if (!CharacterGenerator || typeof CharacterGenerator.generatePhysical !== 'function') {
            missing.push('CharacterGenerator.generatePhysical');
        }
        if (!CharacterGenerator || typeof CharacterGenerator.generatePersonality !== 'function') {
            missing.push('CharacterGenerator.generatePersonality');
        }
        if (!CharacterGenerator || typeof CharacterGenerator.generateStats3d6 !== 'function') {
            missing.push('CharacterGenerator.generateStats3d6');
        }

        if (!CharacterClasses || typeof CharacterClasses.addClassByName !== 'function') {
            missing.push('CharacterClasses.addClassByName');
        }
        if (!CharacterClasses || typeof CharacterClasses.removeClassById !== 'function') {
            missing.push('CharacterClasses.removeClassById');
        }

        if (!FormUtils || typeof FormUtils.setField !== 'function') {
            missing.push('FormUtils.setField');
        }

        if (!NotificationSystem || typeof NotificationSystem.notify !== 'function') {
            missing.push('NotificationSystem.notify');
        }

        if (!UI_CONSTANTS || typeof UI_CONSTANTS.MOBILE_BREAKPOINT !== 'number') {
            missing.push('UI_CONSTANTS.MOBILE_BREAKPOINT');
        }
        if (!UI_CONSTANTS || typeof UI_CONSTANTS.DEBOUNCE_DELAY !== 'number') {
            missing.push('UI_CONSTANTS.DEBOUNCE_DELAY');
        }

        if (missing.length > 0) {
            console.warn('[CharacterEvents] Missing required dependencies:', missing.join(', '));
            return false;
        }

        return true;
    }

    // ============================================================
    // NOTIFICATION - Delegates to NotificationSystem
    // ============================================================

    function notify(message, type) {
        type = type || 'info';
        NotificationSystem.notify(message, type);
    }

    // ============================================================
    // UI REFRESH - Uses CharacterAggregator for projections
    // ============================================================

    function refreshUI(char) {
        // Refresh character list - uses Aggregator internally
        if (window.CharacterList && typeof window.CharacterList.render === 'function') {
            try {
                window.CharacterList.render();
            } catch (e) {
                // Ignore render errors
            }
        }

        // Refresh class tags - uses CharacterClassView (direct AcademyQueries)
        var classTagContainer = document.getElementById('class-tag-container');
        if (classTagContainer) {
            CharacterClassView.renderClassTags(char, classTagContainer);
        }

        // Refresh current classes display - uses CharacterClassView
        var currentClassesDisplay = document.getElementById('current-classes-list');
        if (currentClassesDisplay) {
            CharacterClassView.updateCurrentClassesDisplay(char, currentClassesDisplay);
        }

        // Refresh class selector - uses CharacterClassView
        var classSelect = document.getElementById('academic-class-select');
        if (classSelect) {
            CharacterClassView.populateClassSelector(char, classSelect);
        }

        // Refresh tournament eliminations - uses CharacterEliminationView
        var tournElimContainer = document.getElementById('tournament-eliminations-view');
        if (tournElimContainer) {
            CharacterEliminationView.renderTournamentEliminations(char, tournElimContainer);
        }

        // Refresh standalone eliminations - uses CharacterEliminationView
        var standaloneElimContainer = document.getElementById('standalone-eliminations-container');
        if (standaloneElimContainer) {
            CharacterEliminationView.renderStandaloneEliminations(char, standaloneElimContainer);
        }

        // Update dashboard stats
        if (typeof window.updateDashboardStats === 'function') {
            try {
                window.updateDashboardStats();
            } catch (e) {
                // Ignore render errors
            }
        }
    }

    // ============================================================
    // SAFE EVENT BINDING WITH CLEANUP
    // ============================================================

    function addSafeEventListener(element, eventName, handler, options) {
        if (!element) {
            return;
        }
        element.addEventListener(eventName, handler, options || false);
        _eventListeners.push({
            element: element,
            eventName: eventName,
            handler: handler,
            options: options || false
        });
    }

    function addSafeDelegatedListener(selector, eventName, handler) {
        function wrappedHandler(e) {
            var target = e.target.closest ? e.target.closest(selector) : null;
            if (!target) {
                return;
            }
            handler(e, target);
        }

        document.addEventListener(eventName, wrappedHandler);
        _eventListeners.push({
            element: document,
            eventName: eventName,
            handler: wrappedHandler,
            options: false
        });

        return wrappedHandler;
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
    // MAIN INITIALIZATION
    // ============================================================

    function init(container) {
        if (!checkDependencies()) {
            console.warn('[CharacterEvents] Dependencies not met, skipping initialization');
            return;
        }

        if (_initialized) {
            destroy();
        }

        if (!container) {
            container = document.getElementById('tab-characters');
        }
        if (!container) {
            console.warn('[CharacterEvents] Container not found');
            return;
        }

        // Remove existing listeners before binding new ones
        removeAllEventListeners();

        // Bind all events
        bindToggleList(container);
        bindAddCharacter(container);
        bindFormSubmit(container);
        bindDeleteButton(container);
        bindCancelButton(container);
        bindTabSwitching(container);
        bindFilters(container);
        bindDeceasedToggle(container);
        bindClassTagInput(container);
        bindClassTagRemoval(container);
        bindClickOutside(container);
        bindCharacterList(container);
        bindRandomButtons(container);
        bindSpecialMoveButtons(container);

        _initialized = true;
    }

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
                CharacterForm.render(null);
                if (window.innerWidth < UI_CONSTANTS.MOBILE_BREAKPOINT && typeof window.toggleCharacterList === 'function') {
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
                handleSave();
            });
        }
    }

    function handleSave() {
        var dto = CharacterForm.collect();
        if (!dto) {
            notify('Failed to collect form data.', 'error');
            return;
        }

        // Add the current edit ID to the DTO
        var editId = typeof window.getCurrentEditId === 'function' ? window.getCurrentEditId() : null;
        dto._editId = editId;

        CharacterCRUD.save(dto)
            .then(function(result) {
                if (result && result.success) {
                    var savedId = result.data ? result.data.id : editId;
                    if (savedId) {
                        if (typeof window.setCurrentEditId === 'function') {
                            window.setCurrentEditId(savedId);
                        }
                        // Use CharacterQueries for simple read after save
                        var char = CharacterQueries.getCharacterById(savedId);
                        CharacterForm.render(savedId);
                        refreshUI(char);
                    }
                }
            })
            .catch(function(err) {
                notify('An error occurred while saving.', 'error');
            });
    }

    // ============================================================
    // CANCEL BUTTON
    // ============================================================

    function bindCancelButton(container) {
        var cancelBtn = document.getElementById('cancel-character-form');
        if (cancelBtn) {
            addSafeEventListener(cancelBtn, 'click', function() {
                var editId = typeof window.getCurrentEditId === 'function' ? window.getCurrentEditId() : null;
                if (editId) {
                    // Re-render with saved data to discard unsaved changes
                    CharacterForm.render(editId);
                } else {
                    CharacterForm.hide();
                    if (typeof window.setCurrentEditId === 'function') {
                        window.setCurrentEditId(null);
                    }
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
                var id = typeof window.getCurrentEditId === 'function' ? window.getCurrentEditId() : null;
                if (id) {
                    handleDelete(id);
                }
            });
        }
    }

    function handleDelete(id) {
        if (!id) {
            return;
        }

        // Use CharacterQueries for simple read
        var char = CharacterQueries.getCharacterById(id);
        if (!char) {
            notify('Character not found.', 'error');
            return;
        }

        var name = CharacterQueries.getDisplayName(char);
        if (!confirm('Delete "' + name + '" permanently?')) {
            return;
        }

        CharacterCRUD.delete(id)
            .then(function(result) {
                if (result && result.success) {
                    if (typeof window.setCurrentEditId === 'function') {
                        window.setCurrentEditId(null);
                    }
                    CharacterForm.hide();
                    refreshUI(null);
                    notify('Character deleted successfully!', 'success');
                }
            })
            .catch(function(err) {
                notify('An error occurred while deleting.', 'error');
            });
    }

    // ============================================================
    // TAB SWITCHING
    // ============================================================

    function bindTabSwitching(container) {
        addSafeDelegatedListener('.form-tab-btn', 'click', function(e, target) {
            var tab = target.dataset.tab;
            if (tab) {
                CharacterForm.switchTab(tab);
            }
        });
    }

    // ============================================================
    // FILTERS
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
                }, UI_CONSTANTS.DEBOUNCE_DELAY);
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

        var hideDeceased = document.getElementById('hide-deceased');
        if (hideDeceased) {
            addSafeEventListener(hideDeceased, 'change', function() {
                if (window.CharacterList && typeof window.CharacterList.render === 'function') {
                    window.CharacterList.render();
                }
            });
        }

        var hideEliminated = document.getElementById('hide-eliminated');
        if (hideEliminated) {
            addSafeEventListener(hideEliminated, 'change', function() {
                if (window.CharacterList && typeof window.CharacterList.render === 'function') {
                    window.CharacterList.render();
                }
            });
        }

        var clearFilter = document.getElementById('clear-char-filter');
        if (clearFilter) {
            addSafeEventListener(clearFilter, 'click', function() {
                var nameEl = document.getElementById('char-name-filter');
                var classEl = document.getElementById('char-class-filter');
                var hideDeadEl = document.getElementById('hide-deceased');
                var hideElimEl = document.getElementById('hide-eliminated');

                if (nameEl) {
                    nameEl.value = '';
                }
                if (classEl) {
                    classEl.value = 'all';
                }
                if (hideDeadEl) {
                    hideDeadEl.checked = true;
                }
                if (hideElimEl) {
                    hideElimEl.checked = true;
                }

                if (window.CharacterList && typeof window.CharacterList.render === 'function') {
                    window.CharacterList.render();
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
    // CLASS TAG INPUT
    // ============================================================

    function bindClassTagInput(container) {
        var classInput = document.getElementById('class-tag-input');
        if (classInput) {
            addSafeEventListener(classInput, 'keydown', function(e) {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    var name = this.value.trim();
                    if (name) {
                        handleAddClassByName(name);
                    }
                }
            });
        }
    }

    function handleAddClassByName(name) {
        var charId = typeof window.getCurrentEditId === 'function' ? window.getCurrentEditId() : null;
        if (!charId) {
            notify('Please save the character first.', 'error');
            return;
        }

        // Use CharacterQueries for simple read
        var char = CharacterQueries.getCharacterById(charId);
        if (!char) {
            notify('Character not found.', 'error');
            return;
        }

        CharacterClasses.addClassByName(charId, name)
            .then(function(result) {
                if (result && result.success) {
                    var input = document.getElementById('class-tag-input');
                    if (input) {
                        input.value = '';
                    }
                    refreshUI(char);
                }
            })
            .catch(function(err) {
                notify('Failed to add class.', 'error');
            });
    }

    // ============================================================
    // CLASS TAG REMOVAL
    // ============================================================

    function bindClassTagRemoval(container) {
        addSafeDelegatedListener('.remove-class-tag', 'click', function(e, target) {
            e.stopPropagation();
            var classId = target.dataset.id;
            if (classId) {
                handleRemoveClass(classId);
            }
        });
    }

    function handleRemoveClass(classId) {
        var charId = typeof window.getCurrentEditId === 'function' ? window.getCurrentEditId() : null;
        if (!charId) {
            notify('No character selected.', 'error');
            return;
        }

        CharacterClasses.removeClassById(charId, classId)
            .then(function(result) {
                if (result && result.success) {
                    refreshUI(null);
                }
            })
            .catch(function(err) {
                notify('Failed to remove class.', 'error');
            });
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
        addSafeDelegatedListener('.char-list-item', 'click', function(e, target) {
            var id = target.dataset.id;
            if (id) {
                handleCharacterSelect(id);
            }
        });
    }

    function handleCharacterSelect(id) {
        if (!id) {
            return;
        }

        // Use CharacterQueries for simple read
        var char = CharacterQueries.getCharacterById(id);
        if (!char) {
            notify('Character not found.', 'error');
            return;
        }

        if (typeof window.setCurrentEditId === 'function') {
            window.setCurrentEditId(id);
        }

        CharacterForm.render(id);
        refreshUI(char);

        // Scroll the form into view
        var formContainer = document.getElementById('character-form-container');
        if (formContainer) {
            setTimeout(function() {
                formContainer.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
            }, 100);
        }

        if (window.innerWidth < UI_CONSTANTS.MOBILE_BREAKPOINT && typeof window.toggleCharacterList === 'function') {
            window.toggleCharacterList(false);
        }
    }

    // ============================================================
    // RANDOM BUTTONS
    // ============================================================

    function bindRandomButtons(container) {
        // Physical
        var randomPhysicalBtn = document.getElementById('random-physical-btn');
        if (randomPhysicalBtn) {
            addSafeEventListener(randomPhysicalBtn, 'click', function() {
                fillRandomPhysical();
            });
        }

        // Personality
        var randomPersonalityBtn = document.getElementById('random-personality-btn');
        if (randomPersonalityBtn) {
            addSafeEventListener(randomPersonalityBtn, 'click', function() {
                fillRandomPersonality();
            });
        }

        // Physical stats
        var randomStatsBtn = document.getElementById('random-stats-btn');
        if (randomStatsBtn) {
            addSafeEventListener(randomStatsBtn, 'click', function() {
                fillRandomStats();
            });
        }

        // Magic per-category
        var categories = ['elemental', 'body', 'aether'];
        categories.forEach(function(cat) {
            var btn = document.getElementById('random-' + cat + '-btn');
            if (btn) {
                addSafeEventListener(btn, 'click', function() {
                    fillRandomMagicCategory(cat);
                });
            }
        });

        // All magic
        var randomMagicBtn = document.getElementById('random-magic-btn');
        if (randomMagicBtn) {
            addSafeEventListener(randomMagicBtn, 'click', function() {
                fillRandomMagic();
            });
        }
    }

    function fillRandomPhysical() {
        var physical = CharacterGenerator.generatePhysical();
        FormUtils.setField('char-gender', physical.gender);
        FormUtils.setField('char-eyes', physical.eyes);
        FormUtils.setField('char-hair', physical.hair);
        FormUtils.setField('char-skin', physical.skin);
        FormUtils.setField('char-height', physical.height);
        FormUtils.setField('char-weight', physical.weight);
        FormUtils.setField('char-build', physical.build);
        notify('Random physical appearance generated!', 'info');
    }

    function fillRandomPersonality() {
        var personality = CharacterGenerator.generatePersonality();
        FormUtils.setField('char-personality-traits', personality.traits);
        FormUtils.setField('char-personality-ideals', personality.ideals);
        FormUtils.setField('char-personality-bonds', personality.bonds);
        FormUtils.setField('char-personality-flaws', personality.flaws);
        FormUtils.setField('char-personality-alignment', personality.alignment);
        FormUtils.setField('char-personality-likes', personality.likes);
        FormUtils.setField('char-personality-dislikes', personality.dislikes);
        FormUtils.setField('char-personality-habits', personality.habits);
        FormUtils.setField('char-personality-fears', personality.fears);
        FormUtils.setField('char-personality-goals', personality.goals);
        notify('Random personality generated!', 'info');
    }

    function fillRandomStats() {
        var stats = CharacterGenerator.generateStats3d6();
        var statKeys = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
        statKeys.forEach(function(key) {
            var value = stats[key] !== undefined ? stats[key] : 10;
            FormUtils.setField('char-stat-' + key, value);
        });

        // Refresh class suggestion if the view exposes it
        if (window.CharacterStatsView && typeof window.CharacterStatsView.updateClassSuggestion === 'function') {
            try {
                window.CharacterStatsView.updateClassSuggestion();
            } catch (e) {
                // Ignore suggestion errors
            }
        }

        notify('Random physical stats generated!', 'info');
    }

    function fillRandomMagic() {
        var magic = CharacterGenerator.generateMagic();
        applyMagicToForm(magic);
        notify('Random magic proficiencies generated!', 'info');
    }

    function fillRandomMagicCategory(category) {
        var magic = CharacterGenerator.generateMagicCategory(category);
        applyMagicToForm(magic);

        // Refresh magic class suggestion
        if (window.CharacterStatsView && typeof window.CharacterStatsView.updateMagicClassSuggestion === 'function') {
            try {
                window.CharacterStatsView.updateMagicClassSuggestion();
            } catch (e) {
                // Ignore suggestion errors
            }
        }
        if (window.CharacterStatsView && typeof window.CharacterStatsView.updateMagicPowerDisplay === 'function') {
            try {
                window.CharacterStatsView.updateMagicPowerDisplay();
            } catch (e) {
                // Ignore suggestion errors
            }
        }

        notify('Random ' + category + ' magic generated!', 'info');
    }

    function applyMagicToForm(magic) {
        if (!magic || typeof magic !== 'object') {
            return;
        }
        Object.keys(magic).forEach(function(key) {
            var inputId = 'magic-' + key;
            if (document.getElementById(inputId)) {
                FormUtils.setField(inputId, magic[key]);
            }
        });
    }

    // ============================================================
    // SPECIAL MOVE BUTTONS
    // ============================================================

    function bindSpecialMoveButtons(container) {
        // Add physical move
        var addPhysicalBtn = document.getElementById('add-physical-move-btn');
        if (addPhysicalBtn) {
            addSafeEventListener(addPhysicalBtn, 'click', function() {
                var nameInput = document.getElementById('physical-move-name');
                var descInput = document.getElementById('physical-move-desc');
                var name = nameInput ? nameInput.value.trim() : '';
                var desc = descInput ? descInput.value.trim() : '';
                if (!name) {
                    notify('Move name is required.', 'error');
                    return;
                }
                handleAddSpecialMove('physical', name, desc);
            });
        }

        // Add magical move
        var addMagicalBtn = document.getElementById('add-magical-move-btn');
        if (addMagicalBtn) {
            addSafeEventListener(addMagicalBtn, 'click', function() {
                var nameInput = document.getElementById('magical-move-name');
                var descInput = document.getElementById('magical-move-desc');
                var name = nameInput ? nameInput.value.trim() : '';
                var desc = descInput ? descInput.value.trim() : '';
                if (!name) {
                    notify('Move name is required.', 'error');
                    return;
                }
                handleAddSpecialMove('magical', name, desc);
            });
        }

        // Remove special move (delegated)
        addSafeDelegatedListener('.remove-special-move', 'click', function(e, target) {
            e.stopPropagation();
            var type = target.dataset.type;
            var moveId = target.dataset.moveId;
            if (type && moveId) {
                handleRemoveSpecialMove(type, moveId);
            }
        });

        // Edit special move (delegated)
        addSafeDelegatedListener('.edit-special-move', 'click', function(e, target) {
            e.stopPropagation();
            var type = target.dataset.type;
            var moveId = target.dataset.moveId;
            if (type && moveId) {
                handleEditSpecialMove(type, moveId);
            }
        });

        // Listen for edit modal save event
        document.addEventListener('specialMoveEdit', function(e) {
            if (!e.detail) {
                return;
            }
            var d = e.detail;
            if (d.charId && d.type && d.moveId) {
                handleUpdateSpecialMove(d.charId, d.type, d.moveId, d.name, d.description);
            }
        });
    }

    function handleAddSpecialMove(type, name, description) {
        var charId = typeof window.getCurrentEditId === 'function' ? window.getCurrentEditId() : null;
        if (!charId) {
            notify('Please save the character first.', 'error');
            return;
        }

        if (!window.CharacterStats || typeof window.CharacterStats.addSpecialMove !== 'function') {
            notify('Character stats module not available.', 'error');
            return;
        }

        window.CharacterStats.addSpecialMove(charId, type, name, description)
            .then(function(result) {
                if (result && result.success) {
                    // Clear inputs
                    var nameInput = document.getElementById(type + '-move-name');
                    var descInput = document.getElementById(type + '-move-desc');
                    if (nameInput) {
                        nameInput.value = '';
                    }
                    if (descInput) {
                        descInput.value = '';
                    }
                    refreshSpecialMoves(charId);
                }
            })
            .catch(function(err) {
                notify('Failed to add move.', 'error');
            });
    }

    function handleRemoveSpecialMove(type, moveId) {
        var charId = typeof window.getCurrentEditId === 'function' ? window.getCurrentEditId() : null;
        if (!charId) {
            notify('No character selected.', 'error');
            return;
        }

        if (!window.CharacterStats || typeof window.CharacterStats.removeSpecialMove !== 'function') {
            notify('Character stats module not available.', 'error');
            return;
        }

        window.CharacterStats.removeSpecialMove(charId, type, moveId)
            .then(function(result) {
                if (result && result.success) {
                    refreshSpecialMoves(charId);
                }
            })
            .catch(function(err) {
                notify('Failed to remove move.', 'error');
            });
    }

    function handleUpdateSpecialMove(charId, type, moveId, name, description) {
        if (!window.CharacterStats || typeof window.CharacterStats.updateSpecialMove !== 'function') {
            notify('Character stats module not available.', 'error');
            return;
        }

        window.CharacterStats.updateSpecialMove(charId, type, moveId, name, description)
            .then(function(result) {
                if (result && result.success) {
                    refreshSpecialMoves(charId);
                }
            })
            .catch(function(err) {
                notify('Failed to update move.', 'error');
            });
    }

    function handleEditSpecialMove(type, moveId) {
        var charId = typeof window.getCurrentEditId === 'function' ? window.getCurrentEditId() : null;
        if (!charId) {
            notify('No character selected.', 'error');
            return;
        }

        var char = CharacterQueries.getCharacterById(charId);
        if (!char || !char.specialMoves) {
            return;
        }

        var moves = char.specialMoves[type] || [];
        var move = null;
        for (var i = 0; i < moves.length; i++) {
            if (moves[i] && String(moves[i].id) === String(moveId)) {
                move = moves[i];
                break;
            }
        }

        if (!move) {
            notify('Move not found.', 'error');
            return;
        }

        if (window.CharacterStatsView && typeof window.CharacterStatsView.openEditModal === 'function') {
            window.CharacterStatsView.openEditModal(charId, type, moveId, move.name, move.description);
        }
    }

    function refreshSpecialMoves(charId) {
        var char = CharacterQueries.getCharacterById(charId);
        if (!char) {
            return;
        }

        if (!window.CharacterStatsView || typeof window.CharacterStatsView.renderSpecialMoves !== 'function') {
            return;
        }

        var moves = window.CharacterStats.getSpecialMoves(char);
        window.CharacterStatsView.renderSpecialMoves('physical-moves-list', moves.physical, 'physical');
        window.CharacterStatsView.renderSpecialMoves('magical-moves-list', moves.magical, 'magical');
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.CharacterEvents = {
        init: init,
        destroy: destroy,
        removeAllEventListeners: removeAllEventListeners,
        refreshUI: refreshUI
    };

})();