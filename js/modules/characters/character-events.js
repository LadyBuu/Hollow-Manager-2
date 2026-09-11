/**
 * js/modules/characters/character-events.js - Character Events
 * Path: js/modules/characters/character-events.js
 * 
 * IMPORTANT:
 *   - All bindings for dynamically-rendered elements use DELEGATION
 *     because #character-form-content is re-rendered on every
 *     CharacterForm.render() call. Direct listeners would be lost.
 *   - Static elements (outside the form content) use direct binding.
 *   - Combat tab bindings (roll buttons, class overrides, stat/magic
 *     live updates, weapons, moves) are all delegated.
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
    var CharacterStats = window.CharacterStats;
    var CharacterStatsView = window.CharacterStatsView;
    var CharacterConstants = window.CharacterConstants;
    var MagicConstants = window.MagicConstants;
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
        if (!CharacterForm || typeof CharacterForm.addCareerEntryRow !== 'function') {
            missing.push('CharacterForm.addCareerEntryRow');
        }
        if (!CharacterForm || typeof CharacterForm.addWeaponRow !== 'function') {
            missing.push('CharacterForm.addWeaponRow');
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
        if (!CharacterStats || typeof CharacterStats.rollPhysicalStats !== 'function') {
            missing.push('CharacterStats.rollPhysicalStats');
        }
        if (!CharacterStatsView || typeof CharacterStatsView.populateMagicalFields !== 'function') {
            missing.push('CharacterStatsView.populateMagicalFields');
        }
        if (!CharacterConstants || typeof CharacterConstants.getPhysicalClasses !== 'function') {
            missing.push('CharacterConstants.getPhysicalClasses');
        }
        if (!MagicConstants || typeof MagicConstants.getTypeKeys !== 'function') {
            missing.push('MagicConstants.getTypeKeys');
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

        // Static container elements
        bindToggleList(container);
        bindAddCharacter(container);
        bindFormSubmit(container);
        bindDeleteButton(container);
        bindFilters(container);
        bindClickOutside(container);
        bindCharacterList(container);

        // Dynamically-rendered elements - DELEGATED
        bindTabSwitching();
        bindCancelButton();
        bindDeceasedToggle();
        bindBirthYearListener();
        bindRandomButtons();
        bindPreviousNameButtons();
        bindCareerButtons();
        bindClassTagInput();
        bindClassTagRemoval();

        // Combat tab bindings
        bindCombatRollButtons();
        bindCombatClassOverrides();
        bindCombatLiveUpdates();
        bindWeaponButtons();
        bindSpecialMoveButtons();

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
    // DELEGATED BINDINGS - GENERAL
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
            if (CharacterForm && typeof CharacterForm.applyDeceasedState === 'function') {
                CharacterForm.applyDeceasedState(target.checked);
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

    function bindCareerButtons() {
        addSafeDelegatedListener('#add-career-entry-btn', 'click', function(e, target) {
            e.preventDefault();
            var container = document.getElementById('career-status-container');
            if (!container) { return; }

            if (CharacterForm && typeof CharacterForm.addCareerEntryRow === 'function') {
                CharacterForm.addCareerEntryRow(container);
            }

            var lastRow = container.querySelector('.career-status-entry:last-child');
            if (lastRow) {
                var select = lastRow.querySelector('.career-status-select');
                if (select) { select.focus(); }
            }
        });

        addSafeDelegatedListener('.remove-career-entry', 'click', function(e, target) {
            e.preventDefault();
            var row = target.closest('.career-status-entry');
            if (!row) { return; }

            var parent = row.parentElement;
            if (!parent) { return; }

            if (parent.querySelectorAll('.career-status-entry').length <= 1) {
                var select = row.querySelector('.career-status-select');
                var startEl = row.querySelector('.career-start-year');
                var endEl = row.querySelector('.career-end-year');
                var titleEl = row.querySelector('.career-title');
                if (select) { select.value = ''; }
                if (startEl) { startEl.value = ''; }
                if (endEl) { endEl.value = ''; }
                if (titleEl) { titleEl.value = ''; }
                return;
            }

            row.remove();
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
    // COMBAT - ROLL BUTTONS
    // ============================================================

    function bindCombatRollButtons() {
        addSafeDelegatedListener('#roll-stats-btn', 'click', function(e, target) {
            e.preventDefault();
            handleRollStats();
        });

        addSafeDelegatedListener('#roll-magic-btn', 'click', function(e, target) {
            e.preventDefault();
            handleRollMagic();
        });

        addSafeDelegatedListener('#roll-hp-btn', 'click', function(e, target) {
            e.preventDefault();
            handleRollHP();
        });

        addSafeDelegatedListener('#roll-mp-btn', 'click', function(e, target) {
            e.preventDefault();
            handleRollMP();
        });
    }

    function handleRollStats() {
        if (!CharacterStats || typeof CharacterStats.rollPhysicalStats !== 'function') {
            notify('Stats module not available.', 'error');
            return;
        }

        var rolled = CharacterStats.rollPhysicalStats();
        var statKeys = CharacterStats.STAT_KEYS || ['str','dex','con','int','wis','cha'];

        statKeys.forEach(function(key) {
            FormUtils.setField('char-stat-' + key, rolled[key]);
            updateStatModifierDisplay(key, rolled[key]);
        });

        updatePhysicalClassDisplayFromInputs();
        notify('Random stats generated!', 'info');
    }

    function handleRollMagic() {
        if (!CharacterStats || typeof CharacterStats.rollMagicalProficiencies !== 'function') {
            notify('Magic module not available.', 'error');
            return;
        }

        var rolled = CharacterStats.rollMagicalProficiencies();

        // Fill inputs + update level labels
        if (MagicConstants) {
            MagicConstants.getTypeKeys().forEach(function(type) {
                FormUtils.setField('char-magic-' + type, rolled[type]);
                updateMagicLevelDisplay(type, rolled[type]);
            });
            updateMagicCategoryTotals(rolled);
        }

        updateMagicalClassDisplayFromInputs();
        notify('Random magic generated!', 'info');
    }

    function handleRollHP() {
        if (!CharacterStats || typeof CharacterStats.rollHP !== 'function') {
            notify('Stats module not available.', 'error');
            return;
        }

        var stats = readStatsFromInputs();
        var hp = CharacterStats.rollHP(stats);
        FormUtils.setField('char-hp', hp);
        notify('HP rolled: ' + hp, 'info');
    }

    function handleRollMP() {
        if (!CharacterStats || typeof CharacterStats.rollMP !== 'function') {
            notify('Stats module not available.', 'error');
            return;
        }

        var magic = readMagicFromInputs();
        var mp = CharacterStats.rollMP(magic);
        FormUtils.setField('char-mp', mp);
        notify('MP rolled: ' + mp, 'info');
    }

    // ============================================================
    // COMBAT - CLASS OVERRIDES
    // ============================================================

    function bindCombatClassOverrides() {
        // Physical class override — rewrites stats to match the class
        addSafeDelegatedListener('#physical-class-override', 'change', function(e, target) {
            var classId = target.value;
            if (!classId) { return; }

            if (!CharacterStats || typeof CharacterStats.applyPhysicalClass !== 'function') {
                notify('Stats module not available.', 'error');
                return;
            }

            var newStats = CharacterStats.applyPhysicalClass(classId);
            if (!newStats) {
                notify('Could not apply class.', 'error');
                return;
            }

            var statKeys = CharacterStats.STAT_KEYS || ['str','dex','con','int','wis','cha'];
            statKeys.forEach(function(key) {
                FormUtils.setField('char-stat-' + key, newStats[key]);
                updateStatModifierDisplay(key, newStats[key]);
            });

            updatePhysicalClassDisplayFromInputs();

            // Reset the override dropdown so the derived class shows again
            target.value = '';

            notify('Stats rewritten to match class.', 'info');
        });

        // Broad magical class override — display only
        addSafeDelegatedListener('#broad-class-override', 'change', function(e, target) {
            var classId = target.value;
            var displayEl = document.getElementById('derived-broad-class');
            if (!displayEl) { return; }

            if (!classId) {
                // Revert to derived
                updateMagicalClassDisplayFromInputs();
                return;
            }

            if (MagicConstants) {
                var cls = MagicConstants.getBroadClass(classId);
                if (cls) {
                    displayEl.textContent = cls.label;
                }
            }
        });

        // Fine magical class override — raises target proficiency to 8
        addSafeDelegatedListener('#fine-class-override', 'change', function(e, target) {
            var classId = target.value;
            if (!classId) { return; }

            if (!CharacterStats || typeof CharacterStats.applyFineMagicalClass !== 'function') {
                notify('Stats module not available.', 'error');
                return;
            }

            var currentMagic = readMagicFromInputs();
            var newMagic = CharacterStats.applyFineMagicalClass(classId, currentMagic);
            if (!newMagic) {
                notify('Could not apply fine class.', 'error');
                return;
            }

            if (MagicConstants) {
                MagicConstants.getTypeKeys().forEach(function(type) {
                    FormUtils.setField('char-magic-' + type, newMagic[type]);
                    updateMagicLevelDisplay(type, newMagic[type]);
                });
                updateMagicCategoryTotals(newMagic);
            }

            updateMagicalClassDisplayFromInputs();

            // Reset dropdown
            target.value = '';

            notify('Proficiency raised to Expert.', 'info');
        });
    }

    // ============================================================
    // COMBAT - LIVE UPDATES
    // ============================================================

    function bindCombatLiveUpdates() {
        // Physical stat input change → update modifier + re-derive class
        addSafeDelegatedListener('.stat-input', 'input', function(e, target) {
            var key = target.dataset.statKey;
            if (!key) { return; }
            var value = parseInt(target.value, 10);
            if (isNaN(value)) { return; }
            updateStatModifierDisplay(key, value);
            updatePhysicalClassDisplayFromInputs();
        });

        // Magic input change → update level + category total + re-derive class
        addSafeDelegatedListener('.magic-input', 'input', function(e, target) {
            var type = target.dataset.magicKey;
            if (!type) { return; }
            var value = parseInt(target.value, 10);
            if (isNaN(value)) { return; }
            updateMagicLevelDisplay(type, value);
            var magic = readMagicFromInputs();
            updateMagicCategoryTotals(magic);
            updateMagicalClassDisplayFromInputs();
        });
    }

    function updateStatModifierDisplay(key, value) {
        var el = document.querySelector('[data-modifier-key="' + key + '"]');
        if (!el) { return; }

        var num = parseInt(value, 10);
        if (isNaN(num)) { num = 10; }

        var modifier = Math.floor((num - 10) / 2);
        var display = (modifier >= 0 ? '+' : '') + modifier;
        el.textContent = display;

        if (modifier > 0) {
            el.style.color = 'var(--accent)';
        } else if (modifier < 0) {
            el.style.color = 'var(--danger)';
        } else {
            el.style.color = 'var(--text-dim)';
        }
    }

    function updateMagicLevelDisplay(type, value) {
        var el = document.querySelector('[data-magic-level="' + type + '"]');
        if (!el) { return; }
        if (!MagicConstants || typeof MagicConstants.getProficiencyLevelLabel !== 'function') { return; }
        el.textContent = MagicConstants.getProficiencyLevelLabel(value);
    }

    function updateMagicCategoryTotals(magic) {
        if (!MagicConstants) { return; }
        var order = MagicConstants.getCategoryOrder ? MagicConstants.getCategoryOrder() : ['elemental', 'body', 'aether'];

        order.forEach(function(catId) {
            var types = MagicConstants.getCategoryTypes(catId);
            var total = 0;
            types.forEach(function(t) {
                total += Number(magic[t]) || 0;
            });
            var totalEl = document.querySelector('[data-magic-total="' + catId + '"]');
            if (totalEl) { totalEl.textContent = String(total); }
        });
    }

    function readStatsFromInputs() {
        var result = {};
        var statKeys = CharacterStats && CharacterStats.STAT_KEYS
            ? CharacterStats.STAT_KEYS
            : ['str','dex','con','int','wis','cha'];
        statKeys.forEach(function(key) {
            var value = parseInt(FormUtils.getField('char-stat-' + key), 10);
            result[key] = isNaN(value) ? 10 : value;
        });
        return result;
    }

    function readMagicFromInputs() {
        var result = {};
        if (!MagicConstants) { return result; }
        MagicConstants.getTypeKeys().forEach(function(type) {
            var value = parseInt(FormUtils.getField('char-magic-' + type), 10);
            result[type] = isNaN(value) ? 0 : value;
        });
        return result;
    }

    function updatePhysicalClassDisplayFromInputs() {
        if (!CharacterStats || typeof CharacterStats.derivePhysicalClass !== 'function') { return; }

        var stats = readStatsFromInputs();
        var result = CharacterStats.derivePhysicalClass(stats);

        var el = document.getElementById('derived-physical-class');
        if (!el) { return; }

        el.textContent = (result && result.class) ? result.class.label : '—';
    }

    function updateMagicalClassDisplayFromInputs() {
        if (!CharacterStats || typeof CharacterStats.deriveMagicalClasses !== 'function') { return; }

        var magic = readMagicFromInputs();
        var result = CharacterStats.deriveMagicalClasses(magic);

        var broadEl = document.getElementById('derived-broad-class');
        var fineEl = document.getElementById('derived-fine-class');

        if (broadEl) {
            broadEl.textContent = result.broad ? result.broad.label : '—';
        }
        if (fineEl) {
            fineEl.textContent = result.fine ? result.fine.label : '—';
        }
    }

    // ============================================================
    // COMBAT - WEAPONS
    // ============================================================

    function bindWeaponButtons() {
        addSafeDelegatedListener('#add-weapon-btn', 'click', function(e, target) {
            e.preventDefault();
            var container = document.getElementById('weapons-container');
            if (!container) { return; }

            if (CharacterForm && typeof CharacterForm.addWeaponRow === 'function') {
                CharacterForm.addWeaponRow(container);
            }

            var lastRow = container.querySelector('.weapon-entry:last-child');
            if (lastRow) {
                var nameInput = lastRow.querySelector('.weapon-name');
                if (nameInput) { nameInput.focus(); }
            }
        });

        addSafeDelegatedListener('.remove-weapon', 'click', function(e, target) {
            e.preventDefault();
            var row = target.closest('.weapon-entry');
            if (!row) { return; }
            row.remove();
        });
    }

    // ============================================================
    // COMBAT - SPECIAL MOVES
    // ============================================================

    function bindSpecialMoveButtons() {
        addSafeDelegatedListener('#add-physical-move-btn', 'click', function(e, target) {
            e.preventDefault();
            handleAddMove('physical');
        });

        addSafeDelegatedListener('#add-magical-move-btn', 'click', function(e, target) {
            e.preventDefault();
            handleAddMove('magical');
        });

        addSafeDelegatedListener('.remove-special-move', 'click', function(e, target) {
            e.preventDefault();
            var type = target.dataset.type;
            var moveId = target.dataset.moveId;
            if (!type || !moveId) { return; }
            handleRemoveMove(type, moveId);
        });
    }

    function handleAddMove(type) {
        var charId = typeof window.getCurrentEditId === 'function' ? window.getCurrentEditId() : null;
        if (!charId) {
            notify('Please save the character first.', 'error');
            return;
        }

        var nameEl = document.getElementById(type + '-move-name');
        var descEl = document.getElementById(type + '-move-desc');

        var name = nameEl ? String(nameEl.value || '').trim() : '';
        var desc = descEl ? String(descEl.value || '').trim() : '';

        if (!name) {
            notify('Move name is required.', 'error');
            return;
        }

        if (!CharacterStats || typeof CharacterStats.addSpecialMove !== 'function') {
            notify('Stats module not available.', 'error');
            return;
        }

        CharacterStats.addSpecialMove(charId, type, name, desc)
            .then(function(result) {
                if (result && result.success) {
                    if (nameEl) { nameEl.value = ''; }
                    if (descEl) { descEl.value = ''; }

                    var char = CharacterQueries.getCharacterById(charId);
                    if (char && CharacterStatsView && typeof CharacterStatsView.renderMovesSection === 'function') {
                        CharacterStatsView.renderMovesSection(char);
                    }
                }
            })
            .catch(function() {
                notify('Failed to add move.', 'error');
            });
    }

    function handleRemoveMove(type, moveId) {
        var charId = typeof window.getCurrentEditId === 'function' ? window.getCurrentEditId() : null;
        if (!charId) {
            notify('No character selected.', 'error');
            return;
        }

        if (!confirm('Remove this move?')) { return; }

        if (!CharacterStats || typeof CharacterStats.removeSpecialMove !== 'function') {
            notify('Stats module not available.', 'error');
            return;
        }

        CharacterStats.removeSpecialMove(charId, type, moveId)
            .then(function(result) {
                if (result && result.success) {
                    var char = CharacterQueries.getCharacterById(charId);
                    if (char && CharacterStatsView && typeof CharacterStatsView.renderMovesSection === 'function') {
                        CharacterStatsView.renderMovesSection(char);
                    }
                }
            })
            .catch(function() {
                notify('Failed to remove move.', 'error');
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
            .catch(function() {
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
            .catch(function() {
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
            .catch(function() {
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
            .catch(function() {
                notify('Failed to remove class.', 'error');
            });
    }

    // ============================================================
    // RANDOM FILLERS (Physical tab / Personality tab)
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
