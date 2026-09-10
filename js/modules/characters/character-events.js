/**
 * js/modules/characters/character-events.js - Character Events
 * Path: js/modules/characters/character-events.js
 * 
 * IMPORTANT:
 *   - All bindings for dynamically-rendered elements use DELEGATION
 *     because #character-form-content is re-rendered on every
 *     CharacterForm.render() call. Direct listeners would be lost.
 *   - Static elements (outside the form content) use direct binding.
 */

(function() {
    'use strict';

    if (window.__characterEventsLoaded) {
        return;
    }
    window.__characterEventsLoaded = true;

    // ============================================================
    // DEPENDENCY IMPORTS
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
    // DEPENDENCY CHECK
    // ============================================================

    function checkDependencies() {
        var missing = [];

        var required = ['getCurrentEditId', 'setCurrentEditId', 'toggleCharacterList'];
        required.forEach(function(name) {
            if (typeof window[name] !== 'function') {
                missing.push(name);
            }
        });

        if (!CharacterAggregator || typeof CharacterAggregator.getCharacterDetail !== 'function') {
            missing.push('CharacterAggregator.getCharacterDetail');
        }
        if (!CharacterQueries || typeof CharacterQueries.getCharacterById !== 'function') {
            missing.push('CharacterQueries.getCharacterById');
        }
        if (!CharacterCRUD || typeof CharacterCRUD.save !== 'function') {
            missing.push('CharacterCRUD.save');
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
        if (!CharacterEliminationView || typeof CharacterEliminationView.renderTournamentEliminations !== 'function') {
            missing.push('CharacterEliminationView.renderTournamentEliminations');
        }
        if (!CharacterGenerator || typeof CharacterGenerator.generatePhysical !== 'function') {
            missing.push('CharacterGenerator.generatePhysical');
        }
        if (!CharacterClasses || typeof CharacterClasses.addClassByName !== 'function') {
            missing.push('CharacterClasses.addClassByName');
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

        if (missing.length > 0) {
            console.warn('[CharacterEvents] Missing required dependencies:', missing.join(', '));
            return false;
        }
        return true;
    }

    // ============================================================
    // NOTIFICATION
    // ============================================================

    function notify(message, type) {
        type = type || 'info';
        NotificationSystem.notify(message, type);
    }

    // ============================================================
    // UI REFRESH
    // ============================================================

    function refreshUI(char) {
        if (window.CharacterList && typeof window.CharacterList.render === 'function') {
            try { window.CharacterList.render(); } catch (e) {}
        }

        var classTagContainer = document.getElementById('class-tag-container');
        if (classTagContainer) {
            CharacterClassView.renderClassTags(char, classTagContainer);
        }

        var currentClassesDisplay = document.getElementById('current-classes-list');
        if (currentClassesDisplay) {
            CharacterClassView.updateCurrentClassesDisplay(char, currentClassesDisplay);
        }

        var classSelect = document.getElementById('academic-class-select');
        if (classSelect) {
            CharacterClassView.populateClassSelector(char, classSelect);
        }

        var tournElimContainer = document.getElementById('tournament-eliminations-view');
        if (tournElimContainer) {
            CharacterEliminationView.renderTournamentEliminations(char, tournElimContainer);
        }

        var standaloneElimContainer = document.getElementById('standalone-eliminations-container');
        if (standaloneElimContainer) {
            CharacterEliminationView.renderStandaloneEliminations(char, standaloneElimContainer);
        }

        if (typeof window.updateDashboardStats === 'function') {
            try { window.updateDashboardStats(); } catch (e) {}
        }
    }

    // ============================================================
    // SAFE EVENT BINDING
    // ============================================================

    function addSafeEventListener(element, eventName, handler, options) {
        if (!element) { return; }
        element.addEventListener(eventName, handler, options || false);
        _eventListeners.push({
            element: element,
            eventName: eventName,
            handler: handler,
            options: options || false
        });
    }

    /**
     * Delegate a click/input/etc on document for a selector.
     * Survives DOM replacement of the target.
     */
    function addSafeDelegatedListener(selector, eventName, handler) {
        function wrappedHandler(e) {
            var target = e.target.closest ? e.target.closest(selector) : null;
            if (!target) { return; }
            handler(e, target);
        }

        document.addEventListener(eventName, wrappedHandler);
        _eventListeners.push({
            element: document,
            eventName: eventName,
            handler: wrappedHandler,
            options: false
        });
    }

    function removeAllEventListeners() {
        _eventListeners.forEach(function(item) {
            try {
                item.element.removeEventListener(item.eventName, item.handler, item.options);
            } catch (e) {}
        });
        _eventListeners = [];

        clearTimeout(_filterDebounceTimer);
        _filterDebounceTimer = null;
    }

    // ============================================================
    // INIT / DESTROY
    // ============================================================

    function init(container) {
        if (!checkDependencies()) {
            console.warn('[CharacterEvents] Dependencies not met, skipping initialization');
            return;
        }

        if (_initialized) { destroy(); }

        if (!container) {
            container = document.getElementById('tab-characters');
        }
        if (!container) {
            console.warn('[CharacterEvents] Container not found');
            return;
        }

        removeAllEventListeners();

        // Static container elements (outside form content)
        bindToggleList(container);
        bindAddCharacter(container);
        bindFormSubmit(container);
        bindDeleteButton(container);
        bindFilters(container);
        bindClickOutside(container);
        bindCharacterList(container);

        // Dynamically-rendered elements (inside form content) - DELEGATED
        bindTabSwitching();
        bindCancelButton();
        bindDeceasedToggle();
        bindBirthYearListener();
        bindRandomButtons();
        bindPreviousNameButtons();
        bindClassTagInput();
        bindClassTagRemoval();

        _initialized = true;
    }

    function destroy() {
        removeAllEventListeners();
        _initialized = false;
    }

    // ============================================================
    // STATIC BINDINGS
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

    function bindFormSubmit(container) {
        var form = document.getElementById('character-form');
        if (form) {
            addSafeEventListener(form, 'submit', function(e) {
                e.preventDefault();
                handleSave();
            });
        }
    }

    function bindDeleteButton(container) {
        var deleteBtn = document.getElementById('delete-char-btn');
        if (deleteBtn) {
            addSafeEventListener(deleteBtn, 'click', function() {
                var id = typeof window.getCurrentEditId === 'function' ? window.getCurrentEditId() : null;
                if (id) { handleDelete(id); }
            });
        }
    }

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

                if (nameEl) { nameEl.value = ''; }
                if (classEl) { classEl.value = 'all'; }
                if (hideDeadEl) { hideDeadEl.checked = true; }
                if (hideElimEl) { hideElimEl.checked = true; }

                if (window.CharacterList && typeof window.CharacterList.render === 'function') {
                    window.CharacterList.render();
                }
            });
        }
    }

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

    function bindCharacterList(container) {
        addSafeDelegatedListener('.char-list-item', 'click', function(e, target) {
            var id = target.dataset.id;
            if (id) { handleCharacterSelect(id); }
        });
    }

    // ============================================================
    // DELEGATED BINDINGS (survive form re-render)
    // ============================================================

    function bindTabSwitching() {
        addSafeDelegatedListener('.form-tab-btn', 'click', function(e, target) {
            var tab = target.dataset.tab;
            if (tab) { CharacterForm.switchTab(tab); }
        });
    }

    function bindCancelButton() {
        addSafeDelegatedListener('#cancel-character-form', 'click', function(e, target) {
            var editId = typeof window.getCurrentEditId === 'function' ? window.getCurrentEditId() : null;
            if (editId) {
                CharacterForm.render(editId);
            } else {
                CharacterForm.hide();
                if (typeof window.setCurrentEditId === 'function') {
                    window.setCurrentEditId(null);
                }
            }
        });
    }

    function bindDeceasedToggle() {
        addSafeDelegatedListener('#char-deceased', 'change', function(e, target) {
            var deathFields = document.getElementById('death-fields');
            if (deathFields) {
                deathFields.style.display = target.checked ? 'block' : 'none';
            }
        });
    }

    function bindBirthYearListener() {
        addSafeDelegatedListener('#char-birthYear', 'input', function(e, target) {
            var ageField = document.getElementById('char-age');
            if (!ageField) { return; }

            var by = parseInt(target.value, 10);
            if (isNaN(by)) {
                ageField.value = '';
                return;
            }

            var currentYear = (window.data && typeof window.data.currentYear === 'number')
                ? window.data.currentYear
                : new Date().getFullYear();

            ageField.value = String(currentYear - by);
        });
    }

    function bindRandomButtons() {
        addSafeDelegatedListener('#random-physical-btn', 'click', function(e, target) {
            e.preventDefault();
            fillRandomPhysical();
        });
        addSafeDelegatedListener('#random-personality-btn', 'click', function(e, target) {
            e.preventDefault();
            fillRandomPersonality();
        });
        addSafeDelegatedListener('#random-stats-btn', 'click', function(e, target) {
            e.preventDefault();
            fillRandomStats();
        });
    }

    function bindPreviousNameButtons() {
        addSafeDelegatedListener('#add-previous-name-btn', 'click', function(e, target) {
            var containerEl = document.getElementById('previous-names-container');
            if (!containerEl) { return; }

            if (CharacterForm && typeof CharacterForm.addPreviousNameRow === 'function') {
                CharacterForm.addPreviousNameRow(containerEl, '');
            }

            var lastRow = containerEl.querySelector('.previous-name-row:last-child');
            if (lastRow) {
                var input = lastRow.querySelector('.previous-name-input');
                if (input) { input.focus(); }
            }
        });

        addSafeDelegatedListener('.remove-previous-name', 'click', function(e, target) {
            e.preventDefault();
            var row = target.closest('.previous-name-row');
            if (!row) { return; }

            var parent = row.parentElement;
            if (!parent) { return; }

            if (parent.querySelectorAll('.previous-name-row').length <= 1) {
                var input = row.querySelector('.previous-name-input');
                if (input) { input.value = ''; }
                return;
            }

            row.remove();
        });

        addSafeDelegatedListener('.previous-name-input', 'keydown', function(e, target) {
            if (e.key !== 'Enter') { return; }
            e.preventDefault();

            var parent = target.closest('#previous-names-container');
            if (!parent) { return; }

            if (CharacterForm && typeof CharacterForm.addPreviousNameRow === 'function') {
                CharacterForm.addPreviousNameRow(parent, '');
            }

            var newRow = parent.querySelector('.previous-name-row:last-child');
            var currentRow = target.closest('.previous-name-row');
            if (newRow && currentRow && currentRow.parentElement === parent) {
                currentRow.parentElement.insertBefore(newRow, currentRow.nextSibling);
            }

            if (newRow) {
                var input = newRow.querySelector('.previous-name-input');
                if (input) { input.focus(); }
            }
        });
    }

    function bindClassTagInput() {
        addSafeDelegatedListener('#class-tag-input', 'keydown', function(e, target) {
            if (e.key === 'Enter') {
                e.preventDefault();
                var name = target.value.trim();
                if (name) { handleAddClassByName(name); }
            }
        });
    }

    function bindClassTagRemoval() {
        addSafeDelegatedListener('.remove-class-tag', 'click', function(e, target) {
            e.stopPropagation();
            var classId = target.dataset.id;
            if (classId) { handleRemoveClass(classId); }
        });
    }

    // ============================================================
    // HANDLERS
    // ============================================================

    function handleSave() {
        var dto = CharacterForm.collect();
        if (!dto) {
            notify('Failed to collect form data.', 'error');
            return;
        }

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

    function handleDelete(id) {
        if (!id) { return; }

        var char = CharacterQueries.getCharacterById(id);
        if (!char) {
            notify('Character not found.', 'error');
            return;
        }

        var name = CharacterQueries.getDisplayName(char);
        if (!confirm('Delete "' + name + '" permanently?')) { return; }

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

    function handleCharacterSelect(id) {
        if (!id) { return; }

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

        CharacterClasses.addClassByName(charId, name)
            .then(function(result) {
                if (result && result.success) {
                    var input = document.getElementById('class-tag-input');
                    if (input) { input.value = ''; }
                    refreshUI(char);
                }
            })
            .catch(function(err) {
                notify('Failed to add class.', 'error');
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
    // RANDOM FILLERS
    // ============================================================

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
        var stats = CharacterGenerator.generateStats3d6();
        var statKeys = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
        statKeys.forEach(function(key) {
            var value = stats[key] !== undefined ? stats[key] : 10;
            FormUtils.setField('char-stat-' + key, value);
        });
        notify('Random stats generated!', 'info');
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