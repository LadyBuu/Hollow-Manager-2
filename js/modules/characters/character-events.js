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
 *   - USES CharacterQueries for character data
 *   - USES NotificationSystem for notifications
 *   - USES DomUtils for DOM operations
 *   - USES ActivityLog for activity logging
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
 *   - window.CharacterStats (domain logic)
 *   - window.CharacterStatsView (UI rendering/updates)
 *   - window.CharacterViews
 *   - window.CharacterQueries (from character-queries.js)
 *   - window.NotificationSystem (from notification.js)
 *   - window.ActivityLog (from activity-log.js)
 *   - window.DomUtils (from dom-utils.js)
 *   - window.getCurrentEditId (from index.js)
 *   - window.setCurrentEditId (from index.js)
 *   - window.showCharacterForm (from index.js)
 *   - window.toggleCharacterList (from index.js)
 *   - window.UI_CONSTANTS (from constants.js)
 *   - window.CharacterConstants (from character-constants.js)
 */

(function() {
    'use strict';

    // Guard against duplicate script loading
    if (window.__characterEventsLoaded) {
        return;
    }
    window.__characterEventsLoaded = true;

    // ============================================================
    // DEPENDENCY IMPORTS - NO FALLBACKS (MANDATORY DEPENDENCIES)
    // ============================================================

    var CharacterQueries = window.CharacterQueries;
    var CharacterCRUD = window.CharacterCRUD;
    var CharacterClasses = window.CharacterClasses;
    var CharacterEliminations = window.CharacterEliminations;
    var CharacterStats = window.CharacterStats;
    var CharacterStatsView = window.CharacterStatsView;
    var CharacterViews = window.CharacterViews;
    var NotificationSystem = window.NotificationSystem;
    var ActivityLog = window.ActivityLog;
    var DomUtils = window.DomUtils;
    var CC = window.CharacterConstants;
    var UI_CONSTANTS = window.UI_CONSTANTS || {};
    var MAGIC_CONSTANTS = window.MAGIC_CONSTANTS || {};

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
            'showCharacterForm',
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

        if (!NotificationSystem || typeof NotificationSystem.notify !== 'function') {
            missing.push('NotificationSystem.notify');
        }

        if (!ActivityLog || typeof ActivityLog.record !== 'function') {
            missing.push('ActivityLog.record');
        }

        // Feature modules - warn if missing but don't block
        var featureMissing = [];
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
                'updateSpecialMove'
            ],
            'CharacterStatsView': [
                'updateClassSuggestion',
                'updateMagicClassSuggestion',
                'updateMagicPowerDisplay',
                'populateClassSelect',
                'applyPhysicalClass',
                'applyMagicClass',
                'editSpecialMove',
                'renderSpecialMoves'
            ]
        };

        for (var moduleName in featureModules) {
            if (typeof window[moduleName] === 'undefined' || window[moduleName] === null) {
                featureMissing.push(moduleName + ' (module missing)');
                continue;
            }
            var methods = featureModules[moduleName];
            for (var i = 0; i < methods.length; i++) {
                if (typeof window[moduleName][methods[i]] !== 'function') {
                    featureMissing.push(moduleName + '.' + methods[i]);
                }
            }
        }

        if (missing.length > 0) {
            console.warn('CharacterEvents: Missing required dependencies:', missing.join(', '));
            return false;
        }

        if (featureMissing.length > 0) {
            console.warn('CharacterEvents: Missing feature dependencies:', featureMissing.join(', '));
        }

        return true;
    }

    // ============================================================
    // NOTIFICATION - Uses NotificationSystem (SINGLE SOURCE OF TRUTH)
    // ============================================================

    function showNotification(message, type) {
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
    // MAGIC TYPE HELPERS - Delegate to CharacterConstants
    // ============================================================

    function getMagicTypeKeys() {
        if (CC && typeof CC.getMagicTypeKeys === 'function') {
            return CC.getMagicTypeKeys();
        }
        // Emergency fallback (should never be reached if constants loaded)
        return MAGIC_CONSTANTS.TYPES ? MAGIC_CONSTANTS.TYPES.slice() : [];
    }

    function getMagicCategoryTypes(category) {
        if (CC && typeof CC.getMagicCategoryTypes === 'function') {
            return CC.getMagicCategoryTypes(category);
        }
        if (MAGIC_CONSTANTS && MAGIC_CONSTANTS.CATEGORIES && MAGIC_CONSTANTS.CATEGORIES[category]) {
            return MAGIC_CONSTANTS.CATEGORIES[category].types.slice();
        }
        return [];
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
                if (CharacterCRUD && typeof CharacterCRUD.save === 'function') {
                    CharacterCRUD.save();
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
                if (id && CharacterCRUD && typeof CharacterCRUD.delete === 'function') {
                    CharacterCRUD.delete(id);
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
    // FILTERS - With checkbox support
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
    // CAREER STATUS - DOM-based with event delegation
    // ============================================================

    function bindCareerStatus(container) {
        var addStatusBtn = document.getElementById('add-status-btn');
        if (addStatusBtn) {
            addSafeEventListener(addStatusBtn, 'click', function() {
                var statusContainer = document.getElementById('career-status-container');
                if (CharacterViews && typeof CharacterViews.addCareerStatusEntry === 'function') {
                    CharacterViews.addCareerStatusEntry(statusContainer);
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
                if (CharacterEliminations && typeof CharacterEliminations.addStandalone === 'function') {
                    CharacterEliminations.addStandalone();
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
                    if (CharacterEliminations && typeof CharacterEliminations.removeStandalone === 'function') {
                        CharacterEliminations.removeStandalone(id, eliminationId);
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

                    if (CharacterClasses && typeof CharacterClasses.addClassByName === 'function') {
                        var result = CharacterClasses.addClassByName(name);
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

                if (CharacterClasses && typeof CharacterClasses.removeClassById === 'function') {
                    CharacterClasses.removeClassById(charId, classId);
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
                if (CharacterClasses && typeof CharacterClasses.addToClass === 'function') {
                    CharacterClasses.addToClass();
                }
            });
        }

        var removeFromClassBtn = document.getElementById('remove-from-class-btn');
        if (removeFromClassBtn) {
            addSafeEventListener(removeFromClassBtn, 'click', function() {
                if (CharacterClasses && typeof CharacterClasses.removeFromClass === 'function') {
                    CharacterClasses.removeFromClass();
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
    // CHARACTER LIST - Event delegation with scroll to form
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
        });
    }

    // ============================================================
    // STATS EVENTS - Delegate to CharacterStatsView
    // ============================================================

    function bindStatsEvents(container) {
        var statInputs = ['char-str', 'char-dex', 'char-con', 'char-int', 'char-wis', 'char-cha'];
        statInputs.forEach(function(id) {
            var el = document.getElementById(id);
            if (el) {
                addSafeEventListener(el, 'change', function() {
                    if (CharacterStatsView && typeof CharacterStatsView.updateClassSuggestion === 'function') {
                        CharacterStatsView.updateClassSuggestion();
                    }
                });
                addSafeEventListener(el, 'blur', function() {
                    var val = parseInt(this.value, 10);
                    var statMin = CC ? CC.STAT_MIN : 1;
                    var statMax = CC ? CC.STAT_MAX : 50;
                    if (isNaN(val)) {
                        this.value = CC ? CC.STAT_DEFAULT : 10;
                    } else if (val < statMin) {
                        this.value = statMin;
                    } else if (val > statMax) {
                        this.value = statMax;
                    }
                    if (CharacterStatsView && typeof CharacterStatsView.updateClassSuggestion === 'function') {
                        CharacterStatsView.updateClassSuggestion();
                    }
                });
            }
        });

        var classSelect = document.getElementById('manual-class-select');
        if (classSelect) {
            if (CharacterStatsView && typeof CharacterStatsView.populateClassSelect === 'function') {
                CharacterStatsView.populateClassSelect();
            }

            addSafeEventListener(classSelect, 'change', function() {
                var display = document.getElementById('suggested-class');
                var descDisplay = document.getElementById('class-description-display');

                if (this.value) {
                    var classes = CC && typeof CC.CLASS_DEFINITIONS !== 'undefined'
                        ? CC.CLASS_DEFINITIONS
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
                    if (CharacterStatsView && typeof CharacterStatsView.updateClassSuggestion === 'function') {
                        CharacterStatsView.updateClassSuggestion();
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
                if (CharacterStatsView && typeof CharacterStatsView.applyPhysicalClass === 'function') {
                    CharacterStatsView.applyPhysicalClass();
                }
            });
        }

        var recalcBtn = document.getElementById('recalculate-class-btn');
        if (recalcBtn) {
            addSafeEventListener(recalcBtn, 'click', function() {
                if (CharacterStatsView && typeof CharacterStatsView.updateClassSuggestion === 'function') {
                    CharacterStatsView.updateClassSuggestion();
                }
            });
        }

        var randomBtn = document.getElementById('random-stats-btn');
        if (randomBtn) {
            addSafeEventListener(randomBtn, 'click', function() {
                var stats = typeof window.CharacterGenerator !== 'undefined' && typeof window.CharacterGenerator.generateStats === 'function'
                    ? window.CharacterGenerator.generateStats()
                    : null;

                if (!stats) {
                    showNotification('Character generation is not available.', 'error');
                    return;
                }

                var statKeys = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
                statKeys.forEach(function(key) {
                    var el = document.getElementById('char-' + key);
                    if (el) el.value = stats[key] || 10;
                });

                if (CharacterStatsView && typeof CharacterStatsView.updateClassSuggestion === 'function') {
                    CharacterStatsView.updateClassSuggestion();
                }
            });
        }
    }

    // ============================================================
    // MAGIC EVENTS - Delegate to CharacterStatsView
    // ============================================================

    function bindMagicEvents(container) {
        var magicTypes = getMagicTypeKeys();

        magicTypes.forEach(function(key) {
            var el = document.getElementById('magic-' + key);
            if (el) {
                addSafeEventListener(el, 'change', function() {
                    if (CharacterStatsView && typeof CharacterStatsView.updateMagicClassSuggestion === 'function') {
                        CharacterStatsView.updateMagicClassSuggestion();
                    }
                    if (CharacterStatsView && typeof CharacterStatsView.updateMagicPowerDisplay === 'function') {
                        CharacterStatsView.updateMagicPowerDisplay();
                    }
                });
                addSafeEventListener(el, 'blur', function() {
                    var val = parseInt(this.value, 10);
                    var magicMax = CC ? CC.MAGIC_MAX : 10;
                    if (isNaN(val)) {
                        this.value = 0;
                    } else if (val < 0) {
                        this.value = 0;
                    } else if (val > magicMax) {
                        this.value = magicMax;
                    }
                    if (CharacterStatsView && typeof CharacterStatsView.updateMagicClassSuggestion === 'function') {
                        CharacterStatsView.updateMagicClassSuggestion();
                    }
                    if (CharacterStatsView && typeof CharacterStatsView.updateMagicPowerDisplay === 'function') {
                        CharacterStatsView.updateMagicPowerDisplay();
                    }
                });
            }
        });

        var magicClassSelect = document.getElementById('manual-magic-class-select');
        if (magicClassSelect) {
            addSafeEventListener(magicClassSelect, 'change', function() {
                var display = document.getElementById('suggested-magic-class');
                if (this.value && display) {
                    // Map magic class values to display labels
                    var labels = {
                        'elementalist': 'Elementalist',
                        'body_mage': 'Body Mage',
                        'aether_mage': 'Aether Mage',
                        'geomancer': 'Geomancer',
                        'hydromancer': 'Hydromancer',
                        'pyromancer': 'Pyromancer',
                        'aeromancer': 'Aeromancer',
                        'ferromancer': 'Ferromancer',
                        'dendromancer': 'Dendromancer',
                        'hemomancer': 'Hemomancer',
                        'osteomancer': 'Osteomancer',
                        'psychomancer': 'Psychomancer',
                        'morphomancer': 'Morphomancer',
                        'vitalmancer': 'Vitalmancer',
                        'necromancer': 'Necromancer',
                        'spatiomancer': 'Spatiomancer',
                        'chronomancer': 'Chronomancer',
                        'dimensionist': 'Dimensionist',
                        'voidmancer': 'Voidmancer',
                        'reality_weaver': 'Reality Weaver',
                        'transference_mage': 'Transference Mage'
                    };
                    display.textContent = labels[this.value] || this.value;
                    display.style.color = 'var(--info)';
                    display.style.background = 'var(--info-soft)';
                    display.style.borderColor = 'var(--info)';
                } else {
                    if (CharacterStatsView && typeof CharacterStatsView.updateMagicClassSuggestion === 'function') {
                        CharacterStatsView.updateMagicClassSuggestion();
                    }
                }
            });
        }

        // Apply Magic Class button
        var applyMagicClassBtn = document.getElementById('apply-magic-class-btn');
        if (applyMagicClassBtn) {
            addSafeEventListener(applyMagicClassBtn, 'click', function() {
                if (CharacterStatsView && typeof CharacterStatsView.applyMagicClass === 'function') {
                    CharacterStatsView.applyMagicClass();
                }
            });
        }

        var recalcMagicBtn = document.getElementById('recalculate-magic-class-btn');
        if (recalcMagicBtn) {
            addSafeEventListener(recalcMagicBtn, 'click', function() {
                if (CharacterStatsView && typeof CharacterStatsView.updateMagicClassSuggestion === 'function') {
                    CharacterStatsView.updateMagicClassSuggestion();
                }
                if (CharacterStatsView && typeof CharacterStatsView.updateMagicPowerDisplay === 'function') {
                    CharacterStatsView.updateMagicPowerDisplay();
                }
            });
        }

        // Random Elemental button
        var randomElementalBtn = document.getElementById('random-elemental-btn');
        if (randomElementalBtn) {
            addSafeEventListener(randomElementalBtn, 'click', function() {
                if (typeof window.CharacterGenerator !== 'undefined' && typeof window.CharacterGenerator.generateMagicCategory === 'function') {
                    var magic = window.CharacterGenerator.generateMagicCategory('elemental');
                    var types = getMagicCategoryTypes('elemental');
                    types.forEach(function(key) {
                        var input = document.getElementById('magic-' + key);
                        if (input && magic[key] !== undefined) {
                            input.value = magic[key];
                        }
                    });
                    if (CharacterStatsView && typeof CharacterStatsView.updateMagicClassSuggestion === 'function') {
                        CharacterStatsView.updateMagicClassSuggestion();
                    }
                    if (CharacterStatsView && typeof CharacterStatsView.updateMagicPowerDisplay === 'function') {
                        CharacterStatsView.updateMagicPowerDisplay();
                    }
                } else {
                    showNotification('Character generation is not available.', 'error');
                }
            });
        }

        // Random Body button
        var randomBodyBtn = document.getElementById('random-body-btn');
        if (randomBodyBtn) {
            addSafeEventListener(randomBodyBtn, 'click', function() {
                if (typeof window.CharacterGenerator !== 'undefined' && typeof window.CharacterGenerator.generateMagicCategory === 'function') {
                    var magic = window.CharacterGenerator.generateMagicCategory('body');
                    var types = getMagicCategoryTypes('body');
                    types.forEach(function(key) {
                        var input = document.getElementById('magic-' + key);
                        if (input && magic[key] !== undefined) {
                            input.value = magic[key];
                        }
                    });
                    if (CharacterStatsView && typeof CharacterStatsView.updateMagicClassSuggestion === 'function') {
                        CharacterStatsView.updateMagicClassSuggestion();
                    }
                    if (CharacterStatsView && typeof CharacterStatsView.updateMagicPowerDisplay === 'function') {
                        CharacterStatsView.updateMagicPowerDisplay();
                    }
                } else {
                    showNotification('Character generation is not available.', 'error');
                }
            });
        }

        // Random Aether button
        var randomAetherBtn = document.getElementById('random-aether-btn');
        if (randomAetherBtn) {
            addSafeEventListener(randomAetherBtn, 'click', function() {
                if (typeof window.CharacterGenerator !== 'undefined' && typeof window.CharacterGenerator.generateMagicCategory === 'function') {
                    var magic = window.CharacterGenerator.generateMagicCategory('aether');
                    var types = getMagicCategoryTypes('aether');
                    types.forEach(function(key) {
                        var input = document.getElementById('magic-' + key);
                        if (input && magic[key] !== undefined) {
                            input.value = magic[key];
                        }
                    });
                    if (CharacterStatsView && typeof CharacterStatsView.updateMagicClassSuggestion === 'function') {
                        CharacterStatsView.updateMagicClassSuggestion();
                    }
                    if (CharacterStatsView && typeof CharacterStatsView.updateMagicPowerDisplay === 'function') {
                        CharacterStatsView.updateMagicPowerDisplay();
                    }
                } else {
                    showNotification('Character generation is not available.', 'error');
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

        // Handle delete and edit buttons via delegation
        var physicalList = document.getElementById('physical-moves-list');
        if (physicalList) {
            addSafeEventListener(physicalList, 'click', function(e) {
                var target = e.target.closest ? e.target.closest('.remove-special-move') : null;
                if (target) {
                    handleRemoveSpecialMove(e, 'physical');
                    return;
                }
                var editTarget = e.target.closest ? e.target.closest('.edit-special-move') : null;
                if (editTarget) {
                    handleEditSpecialMove(e, 'physical');
                    return;
                }
            });
        }

        var magicalList = document.getElementById('magical-moves-list');
        if (magicalList) {
            addSafeEventListener(magicalList, 'click', function(e) {
                var target = e.target.closest ? e.target.closest('.remove-special-move') : null;
                if (target) {
                    handleRemoveSpecialMove(e, 'magical');
                    return;
                }
                var editTarget = e.target.closest ? e.target.closest('.edit-special-move') : null;
                if (editTarget) {
                    handleEditSpecialMove(e, 'magical');
                    return;
                }
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

        var char = CharacterQueries.getCharacterById(id);
        if (!char) {
            showNotification('Character not found.', 'error');
            return;
        }

        var nameInput = document.getElementById(type + '-move-name');
        var descInput = document.getElementById(type + '-move-desc');

        var moveName = nameInput ? nameInput.value.trim() : '';
        var moveDesc = descInput ? descInput.value.trim() : '';

        if (!moveName) {
            showNotification('Please enter a move name.', 'error');
            return;
        }

        if (CharacterStats && typeof CharacterStats.addSpecialMove === 'function') {
            var result = CharacterStats.addSpecialMove(id, type, moveName, moveDesc);

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

        var char = CharacterQueries.getCharacterById(id);
        if (!char) {
            showNotification('Character not found.', 'error');
            return;
        }

        var type = target.dataset.type || defaultType || 'physical';
        var index = parseInt(target.dataset.index, 10);
        if (isNaN(index)) return;

        if (CharacterStats && typeof CharacterStats.removeSpecialMove === 'function') {
            CharacterStats.removeSpecialMove(id, type, index);
        } else {
            showNotification('Special move functionality is not available.', 'error');
            return;
        }
    }

    function handleEditSpecialMove(e, defaultType) {
        var target = e.target.closest ? e.target.closest('.edit-special-move') : null;
        if (!target) return;

        var id = typeof window.getCurrentEditId === 'function' ? window.getCurrentEditId() : null;
        if (!id) {
            showNotification('Please save the character first.', 'error');
            return;
        }

        var char = CharacterQueries.getCharacterById(id);
        if (!char) {
            showNotification('Character not found.', 'error');
            return;
        }

        var type = target.dataset.type || defaultType || 'physical';
        var index = parseInt(target.dataset.index, 10);
        if (isNaN(index)) return;

        if (CharacterStatsView && typeof CharacterStatsView.editSpecialMove === 'function') {
            CharacterStatsView.editSpecialMove(id, type, index);
        } else {
            showNotification('Edit functionality is not available.', 'error');
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
