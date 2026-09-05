/**
 * js/modules/characters/character-events.js - Character Events
 * Path: js/modules/characters/character-events.js
 * 
 * This module is responsible for UI event orchestration for the character module.
 * 
 * IMPORTANT:
 *   - ORCHESTRATION ONLY - no domain logic, no direct mutations
 *   - All mutations delegate to the appropriate module (CharacterCRUD, CharacterClasses, etc.)
 *   - Uses CharacterForm.collect() to get form data
 *   - Uses CharacterCRUD for save/delete operations
 *   - Uses CharacterClassView for class rendering
 *   - Uses CharacterEliminationView for elimination rendering
 *   - Uses CharacterDetailQueries for detail data
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
 * DEPENDENCIES:
 *   - window.CharacterQueries (from character-queries.js)
 *   - window.CharacterCRUD (from character-crud.js)
 *   - window.CharacterForm (from character-form.js)
 *   - window.CharacterClassView (from character-class-view.js)
 *   - window.CharacterEliminationView (from character-elimination-view.js)
 *   - window.CharacterDetailQueries (from character-detail-queries.js)
 *   - window.CharacterGenerator (from character-generator.js)
 *   - window.FormUtils (from form-utils.js)
 *   - window.NotificationSystem (from notification.js)
 *   - window.getCurrentEditId (from index.js)
 *   - window.setCurrentEditId (from index.js)
 *   - window.toggleCharacterList (from index.js)
 *   - window.UI_CONSTANTS (from constants.js)
 */

(function() {
    'use strict';

    // Guard against duplicate script loading
    if (window.__characterEventsLoaded) {
        return;
    }
    window.__characterEventsLoaded = true;

    // ============================================================
    // DEPENDENCY IMPORTS - MANDATORY (no fallbacks)
    // ============================================================

    var CharacterQueries = window.CharacterQueries;
    var CharacterCRUD = window.CharacterCRUD;
    var CharacterForm = window.CharacterForm;
    var CharacterClassView = window.CharacterClassView;
    var CharacterEliminationView = window.CharacterEliminationView;
    var CharacterDetailQueries = window.CharacterDetailQueries;
    var CharacterGenerator = window.CharacterGenerator;
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
    // DEPENDENCY CHECK
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

        if (!CharacterGenerator || typeof CharacterGenerator.generatePhysical !== 'function') {
            missing.push('CharacterGenerator.generatePhysical');
        }
        if (!CharacterGenerator || typeof CharacterGenerator.generatePersonality !== 'function') {
            missing.push('CharacterGenerator.generatePersonality');
        }
        if (!CharacterGenerator || typeof CharacterGenerator.generateStats !== 'function') {
            missing.push('CharacterGenerator.generateStats');
        }

        if (!NotificationSystem || typeof NotificationSystem.notify !== 'function') {
            missing.push('NotificationSystem.notify');
        }

        if (!FormUtils || typeof FormUtils.setField !== 'function') {
            missing.push('FormUtils.setField');
        }

        if (missing.length > 0) {
            console.warn('CharacterEvents: Missing dependencies:', missing.join(', '));
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

    function addSafeDelegatedListener(selector, eventName, handler) {
        function wrappedHandler(e) {
            var target = e.target.closest ? e.target.closest(selector) : null;
            if (!target) return;
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
            console.warn('CharacterEvents: Dependencies not met, skipping initialization');
            return;
        }

        if (_initialized) {
            destroy();
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
        bindDeceasedToggle(container);
        bindClassTagInput(container);
        bindClassTagRemoval(container);
        bindClickOutside(container);
        bindCharacterList(container);
        bindRandomButtons(container);

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
                if (window.innerWidth < (UI_CONSTANTS.MOBILE_BREAKPOINT || 768) && typeof window.toggleCharacterList === 'function') {
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

        CharacterCRUD.save(dto)
            .then(function(result) {
                if (result && result.success) {
                    var editId = typeof window.getCurrentEditId === 'function' ? window.getCurrentEditId() : null;
                    if (editId) {
                        var char = CharacterQueries.getCharacterById(editId);
                        CharacterForm.render(editId);
                        refreshUI(char);
                    }
                }
            })
            .catch(function(err) {
                notify('An error occurred while saving.', 'error');
                console.error('[CharacterEvents] Save error:', err);
            });
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
        if (!id) return;

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
                console.error('[CharacterEvents] Delete error:', err);
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
                }, UI_CONSTANTS.DEBOUNCE_DELAY || 300);
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

                if (nameEl) nameEl.value = '';
                if (classEl) classEl.value = 'all';
                if (hideDeadEl) hideDeadEl.checked = true;
                if (hideElimEl) hideElimEl.checked = true;

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

        var char = CharacterQueries.getCharacterById(charId);
        if (!char) {
            notify('Character not found.', 'error');
            return;
        }

        // Use CharacterClasses.addClassByName
        if (window.CharacterClasses && typeof window.CharacterClasses.addClassByName === 'function') {
            window.CharacterClasses.addClassByName(name)
                .then(function(result) {
                    if (result && result.success) {
                        var input = document.getElementById('class-tag-input');
                        if (input) input.value = '';
                        refreshUI(char);
                    }
                })
                .catch(function(err) {
                    notify('Failed to add class.', 'error');
                    console.error('[CharacterEvents] Add class error:', err);
                });
        } else {
            notify('Class functionality is not available.', 'error');
        }
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

        if (window.CharacterClasses && typeof window.CharacterClasses.removeClassById === 'function') {
            window.CharacterClasses.removeClassById(charId, classId)
                .then(function(result) {
                    if (result && result.success) {
                        refreshUI(null);
                    }
                })
                .catch(function(err) {
                    notify('Failed to remove class.', 'error');
                    console.error('[CharacterEvents] Remove class error:', err);
                });
        } else {
            notify('Class functionality is not available.', 'error');
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
        addSafeDelegatedListener('.char-list-item', 'click', function(e, target) {
            var id = target.dataset.id;
            if (id) {
                handleCharacterSelect(id);
            }
        });
    }

    function handleCharacterSelect(id) {
        if (!id) return;

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

        if (window.innerWidth < (UI_CONSTANTS.MOBILE_BREAKPOINT || 768) && typeof window.toggleCharacterList === 'function') {
            window.toggleCharacterList(false);
        }
    }

    // ============================================================
    // RANDOM BUTTONS
    // ============================================================

    function bindRandomButtons(container) {
        var randomPhysicalBtn = document.getElementById('random-physical-btn');
        if (randomPhysicalBtn) {
            addSafeEventListener(randomPhysicalBtn, 'click', function() {
                fillRandomPhysical();
            });
        }

        var randomPersonalityBtn = document.getElementById('random-personality-btn');
        if (randomPersonalityBtn) {
            addSafeEventListener(randomPersonalityBtn, 'click', function() {
                fillRandomPersonality();
            });
        }

        var randomStatsBtn = document.getElementById('random-stats-btn');
        if (randomStatsBtn) {
            addSafeEventListener(randomStatsBtn, 'click', function() {
                fillRandomStats();
            });
        }
    }

    function fillRandomPhysical() {
        var physical = CharacterGenerator.generatePhysical();
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
        var stats = CharacterGenerator.generateStats();
        var statKeys = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
        statKeys.forEach(function(key) {
            var value = stats[key] !== undefined ? stats[key] : 10;
            FormUtils.setField('char-stat-' + key, value);
        });
        notify('Random stats generated!', 'info');
    }

    // ============================================================
    // UI REFRESH
    // ============================================================

    function refreshUI(char) {
        // Refresh character list
        if (window.CharacterList && typeof window.CharacterList.render === 'function') {
            try {
                window.CharacterList.render();
            } catch (e) {
                // Ignore render errors
            }
        }

        // Refresh class tags
        var classTagContainer = document.getElementById('class-tag-container');
        if (classTagContainer) {
            CharacterClassView.renderClassTags(char, classTagContainer);
        }

        // Refresh current classes display
        var currentClassesDisplay = document.getElementById('current-classes-list');
        if (currentClassesDisplay) {
            CharacterClassView.updateCurrentClassesDisplay(char, currentClassesDisplay);
        }

        // Refresh class selector
        var classSelect = document.getElementById('academic-class-select');
        if (classSelect) {
            CharacterClassView.populateClassSelector(char, classSelect);
        }

        // Refresh tournament eliminations
        var tournElimContainer = document.getElementById('tournament-eliminations-view');
        if (tournElimContainer) {
            CharacterEliminationView.renderTournamentEliminations(char, tournElimContainer);
        }

        // Refresh standalone eliminations
        var standaloneElimContainer = document.getElementById('standalone-eliminations-container');
        if (standaloneElimContainer) {
            CharacterEliminationView.renderStandaloneEliminations(char, standaloneElimContainer);
        }

        // Refresh academic view
        var academicView = document.getElementById('academic-view');
        if (academicView && window.CharacterViews && typeof window.CharacterViews.renderAcademic === 'function') {
            try {
                window.CharacterViews.renderAcademic(char);
            } catch (e) {
                // Ignore render errors
            }
        }

        // Refresh professional view
        var professionalView = document.getElementById('professional-view');
        if (professionalView && window.CharacterViews && typeof window.CharacterViews.renderProfessional === 'function') {
            try {
                window.CharacterViews.renderProfessional(char);
            } catch (e) {
                // Ignore render errors
            }
        }

        // Refresh social view
        var socialView = document.getElementById('social-view');
        if (socialView && window.CharacterViews && typeof window.CharacterViews.renderSocial === 'function') {
            try {
                window.CharacterViews.renderSocial(char);
            } catch (e) {
                // Ignore render errors
            }
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
    // EXPOSE
    // ============================================================

    window.CharacterEvents = {
        init: init,
        destroy: destroy,
        removeAllEventListeners: removeAllEventListeners,
        refreshUI: refreshUI
    };

})();