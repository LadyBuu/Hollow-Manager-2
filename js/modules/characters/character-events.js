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
 *   - Social tab bindings (add/edit/delete relationship, group toggles,
 *     graph view, character search filter) are all delegated.
 *   - Academic tab uses a class DROPDOWN (not a free-text input) as of
 *     the Academic tab rework. The Add button reads the selected class
 *     from #academic-class-select and calls CharacterClasses.addToClass.
 *   - SocialCore is initialized on-demand via ensureSocialCoreInitialized()
 *     so the character form's Social tab works even if the top-level
 *     Social tab was never opened.
 *   - Modals are HIDDEN (not destroyed) so they can be reused:
 *     use Modal.hideModal() not Modal.closeModal().
 *
 * REFRESH CONTRACT:
 *   - refreshUI(char) is the SINGLE refresh entry point for the
 *     character module.
 *   - It re-renders the class filter dropdown, the character list,
 *     the academic tab, the elimination views, and the dashboard
 *     stats. It does NOT re-render the whole character form — the
 *     caller is responsible for that via CharacterForm.render(id),
 *     because some handlers (add class, remove class) want to
 *     re-render the form itself to refresh the dropdown + tag list.
 *   - The academic tab refresh delegates to
 *     CharacterClassView.renderAcademicTab, which is the SINGLE
 *     rendering entry point for the academic tab.
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
    var CharacterViews = window.CharacterViews;
    var CharacterConstants = window.CharacterConstants;
    var MagicConstants = window.MagicConstants;
    var SocialConstants = window.SocialConstants;
    var SocialQueries = window.SocialQueries;
    var SocialCore = window.SocialCore;
    var SocialGraph = window.SocialGraph;
    var FormUtils = window.FormUtils;
    var Modal = window.Modal;
    var NotificationSystem = window.NotificationSystem;
    var UI_CONSTANTS = window.UI_CONSTANTS;

    // ============================================================
    // STATE
    // ============================================================

    var _initialized = false;
    var _eventListeners = [];
    var _filterDebounceTimer = null;

    // Social modal state
    var _socialEditId = null;
    var _socialCoreInitialized = false;

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
        if (!CharacterClassView || typeof CharacterClassView.renderAcademicTab !== 'function') {
            missing.push('CharacterClassView.renderAcademicTab');
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

        // Social dependencies — warn but don't fail
        var socialMissing = [];
        if (!SocialConstants) socialMissing.push('SocialConstants');
        if (!SocialQueries) socialMissing.push('SocialQueries');
        if (!SocialCore) socialMissing.push('SocialCore');
        if (!SocialGraph) socialMissing.push('SocialGraph');
        if (!Modal) socialMissing.push('Modal');
        if (socialMissing.length > 0) {
            console.warn('[CharacterEvents] Social dependencies missing (social tab disabled):', socialMissing.join(', '));
        }

        if (missing.length > 0) {
            console.warn('[CharacterEvents] Missing required dependencies:', missing.join(', '));
            return false;
        }
        return true;
    }

    // ============================================================
    // SOCIAL CORE INITIALIZATION
    // ============================================================

    /**
     * Ensure SocialCore has been initialized with a characterProvider.
     * Idempotent — safe to call multiple times.
     */
    function ensureSocialCoreInitialized() {
        if (_socialCoreInitialized) { return true; }

        if (!window.SocialCore || typeof window.SocialCore.init !== 'function') {
            return false;
        }
        if (!window.CharacterQueries || typeof window.CharacterQueries.getCharacterById !== 'function') {
            return false;
        }

        var characterProvider = {
            exists: function(id) {
                if (!id) { return false; }
                var char = window.CharacterQueries.getCharacterById(id);
                return char !== null && char !== undefined;
            }
        };

        try {
            var result = window.SocialCore.init({ characterProvider: characterProvider });
            if (result !== false) {
                _socialCoreInitialized = true;
                return true;
            }
            return false;
        } catch (e) {
            console.warn('[CharacterEvents] SocialCore.init failed:', e);
            return false;
        }
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
    //
    // This is the SINGLE refresh entry point for the character module.
    //
    // REFRESH SCOPE:
    //   - Character list panel
    //   - Academic tab (via CharacterClassView.renderAcademicTab)
    //   - Elimination views
    //   - Dashboard stats
    //
    // NOT IN SCOPE:
    //   - The character form itself. Callers that mutate form-visible
    //     state (add class, remove class) must call CharacterForm.render(id)
    //     themselves, because the form's tab structure needs a full rebuild
    //     to pick up the change (dropdown loses the added class, tag list
    //     gains it, etc.). Attempting to patch the form piecemeal here
    //     would duplicate CharacterForm's rendering logic.
    //
    // CHARACTER CLASS VIEW CONTRACT:
    //   - renderAcademicTab(char, container) is the ONLY entry point for
    //     the academic tab. It internally dispatches to
    //     renderAddClassSection / renderClassesSection /
    //     renderAcademicTeamsSection / renderGradesSection.
    //   - Do NOT call the individual section renderers from here. They
    //     are implementation details of renderAcademicTab.
    //
    // @param {object|null} char - Character object (or null to clear)
    function refreshUI(char) {
        if (window.CharacterList && typeof window.CharacterList.render === 'function') {
            try { window.CharacterList.render(); } catch (e) {}
        }

        var academicContainer = document.getElementById('academic-class-view');
        if (academicContainer && CharacterClassView && typeof CharacterClassView.renderAcademicTab === 'function') {
            try {
                CharacterClassView.renderAcademicTab(char, academicContainer);
            } catch (e) {
                console.warn('[CharacterEvents] renderAcademicTab failed:', e);
            }
        }

        var tournElimContainer = document.getElementById('tournament-eliminations-view');
        if (tournElimContainer && CharacterEliminationView) {
            try {
                CharacterEliminationView.renderTournamentEliminations(char, tournElimContainer);
            } catch (e) {}
        }

        var standaloneElimContainer = document.getElementById('standalone-eliminations-container');
        if (standaloneElimContainer && CharacterEliminationView) {
            try {
                CharacterEliminationView.renderStandaloneEliminations(char, standaloneElimContainer);
            } catch (e) {}
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

        // Ensure SocialCore has a characterProvider so relationship
        // mutations work even if the top-level Social tab was never opened.
        ensureSocialCoreInitialized();

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
        bindClassDropdown();
        bindClassTagRemoval();

        // Combat tab bindings
        bindCombatRollButtons();
        bindCombatClassOverrides();
        bindCombatLiveUpdates();
        bindWeaponButtons();
        bindSpecialMoveButtons();

        // Social tab bindings
        bindSocialButtons();

        _initialized = true;
    }

    function destroy() {
        removeAllEventListeners();
        _initialized = false;
        _socialEditId = null;
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

    // ============================================================
    // ACADEMIC TAB - Class dropdown + tag removal
    // ============================================================
    //
    // The Academic tab no longer uses a free-text class tag input.
    // Instead it uses a dropdown (#academic-class-select) plus an Add
    // button (#academic-class-add-btn). The Add button reads the
    // selected classId and calls CharacterClasses.addToClass, which
    // goes through MutationPipeline and is Promise-based.
    //
    // Removal still uses the same .remove-class-tag buttons rendered
    // by CharacterClassView.

    function bindClassDropdown() {
        addSafeDelegatedListener('#academic-class-add-btn', 'click', function(e, target) {
            e.preventDefault();

            var select = document.getElementById('academic-class-select');
            if (!select) {
                notify('Class dropdown not found.', 'error');
                return;
            }

            var classId = select.value;
            if (!classId) {
                notify('Please select a class.', 'error');
                return;
            }

            handleAddClassById(classId);
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
            target.value = '';
            notify('Stats rewritten to match class.', 'info');
        });

        addSafeDelegatedListener('#broad-class-override', 'change', function(e, target) {
            var classId = target.value;
            var displayEl = document.getElementById('derived-broad-class');
            if (!displayEl) { return; }

            if (!classId) {
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
            target.value = '';
            notify('Proficiency raised to Expert.', 'info');
        });
    }

    // ============================================================
    // COMBAT - LIVE UPDATES
    // ============================================================

    function bindCombatLiveUpdates() {
        addSafeDelegatedListener('.stat-input', 'input', function(e, target) {
            var key = target.dataset.statKey;
            if (!key) { return; }
            var value = parseInt(target.value, 10);
            if (isNaN(value)) { return; }
            updateStatModifierDisplay(key, value);
            updatePhysicalClassDisplayFromInputs();
        });

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

        el.textContent = (result && result.class) ? result.class.label : '\u2014';
    }

    function updateMagicalClassDisplayFromInputs() {
        if (!CharacterStats || typeof CharacterStats.deriveMagicalClasses !== 'function') { return; }

        var magic = readMagicFromInputs();
        var result = CharacterStats.deriveMagicalClasses(magic);

        var broadEl = document.getElementById('derived-broad-class');
        var fineEl = document.getElementById('derived-fine-class');

        if (broadEl) {
            broadEl.textContent = result.broad ? result.broad.label : '\u2014';
        }
        if (fineEl) {
            fineEl.textContent = result.fine ? result.fine.label : '\u2014';
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
    // SOCIAL - Main entry
    // ============================================================

    function bindSocialButtons() {
        addSafeDelegatedListener('#add-char-relationship-btn', 'click', function(e, target) {
            e.preventDefault();
            openRelationshipModal(null);
        });

        addSafeDelegatedListener('#view-char-social-graph', 'click', function(e, target) {
            e.preventDefault();
            openCharacterGraphModal();
        });

        addSafeDelegatedListener('.relationship-group-header', 'click', function(e, target) {
            e.preventDefault();
            var group = target.closest('.relationship-group');
            if (!group) { return; }
            var body = group.querySelector('.relationship-group-body');
            var caret = group.querySelector('.relationship-group-caret');
            if (!body) { return; }

            var isHidden = body.style.display === 'none';
            body.style.display = isHidden ? 'block' : 'none';
            if (caret) {
                caret.textContent = isHidden ? '\u25be' : '\u25b8';
            }
        });

        addSafeDelegatedListener('.edit-char-relationship', 'click', function(e, target) {
            e.preventDefault();
            e.stopPropagation();
            var relId = target.dataset.relId;
            if (relId) { openRelationshipModal(relId); }
        });

        addSafeDelegatedListener('.delete-char-relationship', 'click', function(e, target) {
            e.preventDefault();
            e.stopPropagation();
            var relId = target.dataset.relId;
            if (relId) { handleDeleteRelationship(relId); }
        });

        addSafeDelegatedListener('#rel-char1-search', 'input', function(e, target) {
            filterCharacterOptions('rel-char1', target.value);
        });

        addSafeDelegatedListener('#rel-char2-search', 'input', function(e, target) {
            filterCharacterOptions('rel-char2', target.value);
        });

        addSafeDelegatedListener('#character-relationship-form', 'submit', function(e) {
            e.preventDefault();
            handleSaveRelationship();
        });

        addSafeDelegatedListener('#close-char-relationship-modal', 'click', function(e, target) {
            e.preventDefault();
            closeRelationshipModal();
        });

        addSafeDelegatedListener('#cancel-char-relationship-modal', 'click', function(e, target) {
            e.preventDefault();
            closeRelationshipModal();
        });

        addSafeDelegatedListener('#character-relationship-modal', 'click', function(e, target) {
            if (e.target === target) {
                closeRelationshipModal();
            }
        });

        addSafeDelegatedListener('#close-char-graph-modal', 'click', function(e, target) {
            e.preventDefault();
            closeCharacterGraphModal();
        });

        addSafeDelegatedListener('#character-graph-modal', 'click', function(e, target) {
            if (e.target === target) {
                closeCharacterGraphModal();
            }
        });
    }

    function openRelationshipModal(relId) {
        var charId = typeof window.getCurrentEditId === 'function' ? window.getCurrentEditId() : null;
        if (!charId) {
            notify('Please save the character first.', 'error');
            return;
        }

        ensureSocialCoreInitialized();

        if (!SocialCore || !SocialQueries || !SocialConstants) {
            notify('Social module not available.', 'error');
            return;
        }

        var formContainer = document.getElementById('character-relationship-form-container');
        if (!formContainer) {
            notify('Relationship form container not found.', 'error');
            return;
        }

        var CharacterViews = window.CharacterViews;
        if (!CharacterViews || typeof CharacterViews.buildRelationshipFormHTML !== 'function') {
            notify('Character views module not available.', 'error');
            return;
        }

        _socialEditId = relId || null;

        var existingRel = null;
        if (_socialEditId) {
            existingRel = SocialQueries.getRelationshipById(_socialEditId);
            if (!existingRel) {
                notify('Relationship not found.', 'error');
                _socialEditId = null;
                return;
            }
        }

        formContainer.innerHTML = CharacterViews.buildRelationshipFormHTML(charId, existingRel);

        var titleEl = document.getElementById('character-relationship-modal-title');
        if (titleEl) {
            titleEl.textContent = _socialEditId ? 'Edit Relationship' : 'Add Relationship';
        }

        var modal = document.getElementById('character-relationship-modal');
        if (modal && Modal && typeof Modal.showModal === 'function') {
            Modal.showModal(modal);
        } else if (modal) {
            modal.classList.remove('hidden');
            modal.style.display = 'flex';
        }
    }

    function closeRelationshipModal() {
        _socialEditId = null;
        var modal = document.getElementById('character-relationship-modal');
        if (!modal) { return; }

        if (Modal && typeof Modal.hideModal === 'function') {
            Modal.hideModal(modal);
        } else {
            modal.classList.add('hidden');
            modal.style.display = 'none';
        }
    }

    function filterCharacterOptions(selectId, query) {
        var select = document.getElementById(selectId);
        if (!select) { return; }

        var term = String(query || '').toLowerCase().trim();
        var options = select.querySelectorAll('option');
        var firstVisible = null;

        options.forEach(function(opt) {
            var matches = !term || opt.textContent.toLowerCase().indexOf(term) !== -1;
            opt.style.display = matches ? '' : 'none';
            opt.hidden = !matches;
            if (matches && !firstVisible) {
                firstVisible = opt;
            }
        });

        if (select.selectedOptions && select.selectedOptions.length > 0) {
            var selected = select.selectedOptions[0];
            if (selected.style.display === 'none') {
                if (firstVisible) { firstVisible.selected = true; }
                else { select.value = ''; }
            }
        }
    }

    function handleSaveRelationship() {
        var charId = typeof window.getCurrentEditId === 'function' ? window.getCurrentEditId() : null;
        if (!charId) {
            notify('No character selected.', 'error');
            return;
        }

        ensureSocialCoreInitialized();

        var char1El = document.getElementById('rel-char1');
        var char2El = document.getElementById('rel-char2');
        var typeEl = document.getElementById('rel-type');
        var titleEl = document.getElementById('rel-title');
        var startEl = document.getElementById('rel-start-year');
        var endEl = document.getElementById('rel-end-year');
        var notesEl = document.getElementById('rel-notes');

        var char1 = char1El ? String(char1El.value || '').trim() : '';
        var char2 = char2El ? String(char2El.value || '').trim() : '';
        var typeId = typeEl ? String(typeEl.value || '').trim() : '';
        var title = titleEl ? String(titleEl.value || '').trim() : '';
        var startYear = startEl ? String(startEl.value || '').trim() : '';
        var endYear = endEl ? String(endEl.value || '').trim() : '';
        var notes = notesEl ? String(notesEl.value || '').trim() : '';

        if (!char1 || !char2 || !typeId) {
            notify('Please fill in Character 1, Character 2, and Type.', 'error');
            return;
        }

        if (char1 === char2) {
            notify('Cannot create a relationship between the same character.', 'error');
            return;
        }

        if (!SocialCore) {
            notify('Social module not available.', 'error');
            return;
        }

        var promise;

        if (_socialEditId) {
            promise = SocialCore.updateRelationship(_socialEditId, {
                character1: char1,
                character2: char2,
                typeId: typeId,
                clarification: title,
                startYear: startYear,
                endYear: endYear,
                notes: notes
            });
        } else {
            promise = SocialCore.createRelationship(
                char1, char2, typeId,
                startYear, endYear,
                title, notes
            );
        }

        promise
            .then(function(result) {
                if (result && result.success) {
                    closeRelationshipModal();
                    var char = CharacterQueries.getCharacterById(charId);
                    if (char && CharacterViews && typeof CharacterViews.renderCharacterSocial === 'function') {
                        CharacterViews.renderCharacterSocial(char);
                    }
                } else if (result && result.message) {
                    notify(result.message, 'error');
                }
            })
            .catch(function() {
                notify('Failed to save relationship.', 'error');
            });
    }

    function handleDeleteRelationship(relId) {
        if (!relId) { return; }
        if (!SocialCore || !SocialQueries) {
            notify('Social module not available.', 'error');
            return;
        }

        var rel = SocialQueries.getRelationshipById(relId);
        if (!rel) {
            notify('Relationship not found.', 'error');
            return;
        }

        var name1 = 'Unknown';
        var name2 = 'Unknown';
        var label = 'relationship';

        if (SocialConstants && typeof SocialConstants.getLabel === 'function') {
            label = SocialConstants.getLabel(rel.typeId);
        }

        if (CharacterQueries) {
            var c1 = CharacterQueries.getCharacterById(rel.character1);
            var c2 = CharacterQueries.getCharacterById(rel.character2);
            if (c1) { name1 = CharacterQueries.getDisplayName(c1); }
            if (c2) { name2 = CharacterQueries.getDisplayName(c2); }
        }

        if (!confirm('Delete the ' + label + ' relationship between ' + name1 + ' and ' + name2 + '?')) {
            return;
        }

        SocialCore.deleteRelationship(relId)
            .then(function(result) {
                if (result && result.success) {
                    var charId = typeof window.getCurrentEditId === 'function' ? window.getCurrentEditId() : null;
                    if (charId) {
                        var char = CharacterQueries.getCharacterById(charId);
                        var CharacterViews = window.CharacterViews;
                        if (char && CharacterViews && typeof CharacterViews.renderCharacterSocial === 'function') {
                            CharacterViews.renderCharacterSocial(char);
                        }
                    }
                }
            })
            .catch(function() {
                notify('Failed to delete relationship.', 'error');
            });
    }

    function openCharacterGraphModal() {
        var charId = typeof window.getCurrentEditId === 'function' ? window.getCurrentEditId() : null;
        if (!charId) {
            notify('Please save the character first.', 'error');
            return;
        }

        if (!SocialGraph || typeof SocialGraph.renderGraph !== 'function') {
            notify('Graph module not available.', 'error');
            return;
        }

        var CharacterViews = window.CharacterViews;
        if (!CharacterViews || typeof CharacterViews.buildGraphModalHTML !== 'function') {
            notify('Character views module not available.', 'error');
            return;
        }

        var existing = document.getElementById('character-graph-modal');
        if (!existing) {
            var wrapper = document.createElement('div');
            wrapper.innerHTML = CharacterViews.buildGraphModalHTML();
            document.body.appendChild(wrapper.firstElementChild);
        }

        var modal = document.getElementById('character-graph-modal');
        if (modal && Modal && typeof Modal.showModal === 'function') {
            Modal.showModal(modal);
        } else if (modal) {
            modal.classList.remove('hidden');
            modal.style.display = 'flex';
        }

        setTimeout(function() {
            if (CharacterViews && typeof CharacterViews.renderCharacterGraph === 'function') {
                CharacterViews.renderCharacterGraph(charId);
            }
        }, 50);
    }

    function closeCharacterGraphModal() {
        var modal = document.getElementById('character-graph-modal');
        if (!modal) { return; }

        if (Modal && typeof Modal.hideModal === 'function') {
            Modal.hideModal(modal);
        } else {
            modal.classList.add('hidden');
            modal.style.display = 'none';
        }
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

    /**
     * Add a class to the character by class ID (via the dropdown).
     *
     * Uses CharacterClasses.addToClass, which is Promise-based and
     * goes through MutationPipeline. On success, MutationPipeline has
     * already shown the success toast, so this handler does not notify
     * again — it just refreshes the affected UI.
     *
     * @param {string} classId - Class ID
     */
    function handleAddClassById(classId) {
        var charId = typeof window.getCurrentEditId === 'function' ? window.getCurrentEditId() : null;
        if (!charId) {
            notify('Please save the character first.', 'error');
            return;
        }

        if (!classId) {
            notify('Please select a class.', 'error');
            return;
        }

        var char = CharacterQueries.getCharacterById(charId);
        if (!char) {
            notify('Character not found.', 'error');
            return;
        }

        if (!CharacterClasses || typeof CharacterClasses.addToClass !== 'function') {
            notify('Character classes module not available.', 'error');
            return;
        }

        CharacterClasses.addToClass(charId, classId)
            .then(function(result) {
                if (result && result.success) {
                    // MutationPipeline already showed the success toast.
                    // Re-render the character form so the Academic tab
                    // picks up the new class (dropdown loses it, tag
                    // list gains it). Then refresh the surrounding
                    // character UI (list, tags, etc).
                    CharacterForm.render(charId);
                    var refreshedChar = CharacterQueries.getCharacterById(charId);
                    refreshUI(refreshedChar);
                }
                // On failure, MutationPipeline already showed the toast.
            })
            .catch(function(err) {
                notify('Failed to add class.', 'error');
                console.error('[CharacterEvents] handleAddClassById error:', err);
            });
    }

    /**
     * Add a class to the character by name.
     *
     * Kept for backward compatibility. It is still called from places
     * that have a name rather than an ID. Uses CharacterClasses.addClassByName,
     * which is Promise-based and goes through MutationPipeline.
     *
     * @param {string} name - Class name
     */
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

        if (!CharacterClasses || typeof CharacterClasses.addClassByName !== 'function') {
            notify('Character classes module not available.', 'error');
            return;
        }

        CharacterClasses.addClassByName(charId, name)
            .then(function(result) {
                if (result && result.success) {
                    // MutationPipeline already showed the success toast.
                    CharacterForm.render(charId);
                    var refreshedChar = CharacterQueries.getCharacterById(charId);
                    refreshUI(refreshedChar);
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

        if (!CharacterClasses || typeof CharacterClasses.removeClassById !== 'function') {
            notify('Character classes module not available.', 'error');
            return;
        }

        CharacterClasses.removeClassById(charId, classId)
            .then(function(result) {
                if (result && result.success) {
                    // MutationPipeline already showed the success toast.
                    // Re-render the form so the tag is removed and the
                    // class reappears in the dropdown.
                    CharacterForm.render(charId);
                    var refreshedChar = CharacterQueries.getCharacterById(charId);
                    refreshUI(refreshedChar);
                }
                // On failure, MutationPipeline already showed the toast.
            })
            .catch(function(err) {
                notify('Failed to remove class.', 'error');
                console.error('[CharacterEvents] handleRemoveClass error:', err);
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
        refreshUI: refreshUI,
        handleAddClassById: handleAddClassById,
        handleAddClassByName: handleAddClassByName,
        handleRemoveClass: handleRemoveClass
    };

})();