/**
 * modules/characters/character-class-view.js - Character Class View
 * Renders class tags, selectors, and class management UI for characters
 * Path: js/modules/characters/character-class-view.js
 * 
 * This module is responsible for:
 *   - Rendering class tags in the form
 *   - Populating class selectors
 *   - Displaying current classes
 *   - Managing class tag container state
 * 
 * IMPORTANT:
 *   - RENDER ONLY - no mutations, no persistence
 *   - No direct window.data access - uses ClassesQueries
 *   - Uses CharacterQueries for character data
 *   - Uses DomUtils for safe DOM operations
 *   - All user-controlled content uses textContent
 *   - No event binding here (delegated to CharacterEvents)
 * 
 * DEPENDENCIES:
 *   - window.ClassesQueries (from classes-queries.js) - MANDATORY
 *   - window.CharacterQueries (from character-queries.js) - MANDATORY
 *   - window.DomUtils (from dom-utils.js) - MANDATORY
 *   - window.CharacterConstants (from character-constants.js) - MANDATORY
 * 
 * USAGE:
 *   var CV = window.CharacterClassView;
 *   CV.populateClassSelector(char);
 *   CV.renderClassTags(char);
 *   CV.updateCurrentClassesDisplay(char);
 */

(function() {
    'use strict';

    // Guard against duplicate loading
    if (window.__characterClassViewLoaded) {
        return;
    }
    window.__characterClassViewLoaded = true;

    // ============================================================
    // DEPENDENCY IMPORTS - MANDATORY (no fallbacks)
    // ============================================================

    var ClassesQueries = window.ClassesQueries;
    var CharacterQueries = window.CharacterQueries;
    var DomUtils = window.DomUtils;
    var CharacterConstants = window.CharacterConstants;

    // ============================================================
    // DEPENDENCY CHECK
    // ============================================================

    function checkDependencies() {
        var missing = [];

        if (!ClassesQueries || typeof ClassesQueries.getClasses !== 'function') {
            missing.push('ClassesQueries.getClasses');
        }
        if (!ClassesQueries || typeof ClassesQueries.getClassDisplayName !== 'function') {
            missing.push('ClassesQueries.getClassDisplayName');
        }
        if (!ClassesQueries || typeof ClassesQueries.isCharacterInClass !== 'function') {
            missing.push('ClassesQueries.isCharacterInClass');
        }

        if (!CharacterQueries || typeof CharacterQueries.getCharacterById !== 'function') {
            missing.push('CharacterQueries.getCharacterById');
        }
        if (!CharacterQueries || typeof CharacterQueries.getDisplayName !== 'function') {
            missing.push('CharacterQueries.getDisplayName');
        }

        if (!DomUtils || typeof DomUtils.createElement !== 'function') {
            missing.push('DomUtils.createElement');
        }

        if (missing.length > 0) {
            console.warn('[CharacterClassView] Missing dependencies:', missing.join(', '));
            return false;
        }

        return true;
    }

    // ============================================================
    // SAFE ELEMENT CREATION
    // ============================================================

    function createEmptyState(message) {
        var el = document.createElement('span');
        el.style.cssText = 'color:var(--text-dim);font-size:0.7rem;padding:4px;';
        el.textContent = message || 'No classes assigned';
        return el;
    }

    // ============================================================
    // CLASS TAG RENDERING
    // ============================================================

    /**
     * Render class tags for a character.
     * 
     * @param {object} char - Character object
     * @param {HTMLElement} container - Container element (optional)
     */
    function renderClassTags(char, container) {
        if (!container) {
            container = document.getElementById('class-tag-container');
        }
        if (!container) return;

        clearClassTags(container);

        if (!char) {
            container.appendChild(createEmptyState('No character selected'));
            return;
        }

        var classIds = getNormalisedClassIds(char);

        if (classIds.length === 0) {
            container.appendChild(createEmptyState('No classes assigned'));
            return;
        }

        var classes = ClassesQueries.getClasses();

        classIds.forEach(function(classId) {
            var cls = classes.find(function(c) {
                return c && String(c.id) === String(classId);
            });

            if (cls) {
                var tag = createClassTag(cls.id, cls.name);
                container.appendChild(tag);
            }
        });

        // If no valid classes found
        if (container.children.length === 0) {
            container.appendChild(createEmptyState('No valid classes assigned'));
        }
    }

    /**
     * Create a single class tag element.
     * 
     * @param {string} classId - Class ID
     * @param {string} className - Class name
     * @returns {HTMLElement} Class tag element
     */
    function createClassTag(classId, className) {
        var tag = document.createElement('span');
        tag.className = 'class-tag';
        tag.style.cssText = 'background:var(--accent-soft);padding:2px 8px;border-radius:10px;font-size:0.7rem;border:1px solid var(--accent);display:inline-flex;align-items:center;gap:4px;';
        tag.dataset.classId = classId;

        var nameSpan = document.createElement('span');
        nameSpan.textContent = className;
        tag.appendChild(nameSpan);

        var button = document.createElement('button');
        button.className = 'remove-class-tag';
        button.dataset.id = classId;
        button.textContent = '✕';
        button.style.cssText = 'background:none;border:none;color:var(--danger);cursor:pointer;font-size:0.5rem;padding:0 2px;';
        button.setAttribute('aria-label', 'Remove class ' + className);
        tag.appendChild(button);

        return tag;
    }

    /**
     * Clear all class tags from a container.
     * 
     * @param {HTMLElement} container - Container element
     */
    function clearClassTags(container) {
        if (!container) {
            container = document.getElementById('class-tag-container');
        }
        if (!container) return;

        container.textContent = '';
    }

    /**
     * Get all class tag IDs from a container.
     * 
     * @param {HTMLElement} container - Container element
     * @returns {string[]} Array of class IDs
     */
    function getClassTagIds(container) {
        if (!container) {
            container = document.getElementById('class-tag-container');
        }
        if (!container) return [];

        var ids = [];
        container.querySelectorAll('[data-class-id]').forEach(function(tag) {
            ids.push(tag.dataset.classId);
        });
        return ids;
    }

    /**
     * Get normalised class IDs from a character.
     * 
     * @param {object} char - Character object
     * @returns {string[]} Array of class IDs
     */
    function getNormalisedClassIds(char) {
        if (!char) return [];
        if (!Array.isArray(char.classIds)) return [];

        var seen = new Set();
        return char.classIds.filter(function(id) {
            if (id === undefined || id === null || id === '') return false;
            var key = String(id);
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
    }

    // ============================================================
    // CLASS SELECTOR POPULATION
    // ============================================================

    /**
     * Populate the academic class selector.
     * 
     * @param {object} char - Character object
     * @param {HTMLElement} select - Select element (optional)
     */
    function populateClassSelector(char, select) {
        if (!select) {
            select = document.getElementById('academic-class-select');
        }
        if (!select) return;

        var classes = ClassesQueries.getClasses();
        var existingClassIds = (char && Array.isArray(char.classIds)) ? char.classIds : [];

        // Preserve current value if possible
        var currentValue = select.value;

        select.innerHTML = '<option value="">Select a class...</option>';

        // Sort classes by name
        var sorted = classes.slice().sort(function(a, b) {
            return (a.name || '').localeCompare(b.name || '');
        });

        sorted.forEach(function(cls) {
            if (!cls) return;

            var isAssigned = existingClassIds.some(function(cid) {
                return String(cid) === String(cls.id);
            });

            if (!isAssigned) {
                var option = document.createElement('option');
                option.value = cls.id;
                option.textContent = cls.name;
                select.appendChild(option);
            }
        });

        // Restore selection if it still exists
        if (currentValue) {
            var exists = false;
            for (var i = 0; i < select.options.length; i++) {
                if (String(select.options[i].value) === String(currentValue)) {
                    exists = true;
                    break;
                }
            }
            if (exists) {
                select.value = currentValue;
            } else {
                select.value = '';
            }
        } else {
            select.value = '';
        }
    }

    /**
     * Populate the class filter dropdown.
     * 
     * @param {HTMLElement} select - Select element (optional)
     */
    function populateClassFilter(select) {
        if (!select) {
            select = document.getElementById('char-class-filter');
        }
        if (!select) return;

        var classes = ClassesQueries.getClasses();
        var currentValue = select.value;

        select.innerHTML = '<option value="all">All Classes</option>';

        var sorted = classes.slice().sort(function(a, b) {
            return (a.name || '').localeCompare(b.name || '');
        });

        sorted.forEach(function(cls) {
            if (!cls) return;

            var option = document.createElement('option');
            option.value = cls.id;
            option.textContent = cls.name;
            select.appendChild(option);
        });

        // Restore selection if it still exists
        if (currentValue) {
            var exists = false;
            for (var i = 0; i < select.options.length; i++) {
                if (String(select.options[i].value) === String(currentValue)) {
                    exists = true;
                    break;
                }
            }
            if (exists) {
                select.value = currentValue;
            } else {
                select.value = 'all';
            }
        } else {
            select.value = 'all';
        }
    }

    // ============================================================
    // CURRENT CLASSES DISPLAY
    // ============================================================

    /**
     * Update the current classes display.
     * 
     * @param {object} char - Character object
     * @param {HTMLElement} display - Display element (optional)
     */
    function updateCurrentClassesDisplay(char, display) {
        if (!display) {
            display = document.getElementById('current-classes-list');
        }
        if (!display) return;

        if (!char) {
            display.textContent = 'None';
            return;
        }

        var classIds = getNormalisedClassIds(char);

        if (classIds.length === 0) {
            display.textContent = 'None';
            return;
        }

        var classes = ClassesQueries.getClasses();
        var names = [];

        classIds.forEach(function(cid) {
            var cls = classes.find(function(c) {
                return c && String(c.id) === String(cid);
            });
            if (cls) {
                names.push(cls.name);
            }
        });

        display.textContent = names.length > 0 ? names.join(', ') : 'None';
    }

    /**
     * Get the current classes display text.
     * 
     * @param {object} char - Character object
     * @returns {string} Display text
     */
    function getCurrentClassesDisplayText(char) {
        if (!char) return 'None';

        var classIds = getNormalisedClassIds(char);

        if (classIds.length === 0) return 'None';

        var classes = ClassesQueries.getClasses();
        var names = [];

        classIds.forEach(function(cid) {
            var cls = classes.find(function(c) {
                return c && String(c.id) === String(cid);
            });
            if (cls) {
                names.push(cls.name);
            }
        });

        return names.length > 0 ? names.join(', ') : 'None';
    }

    // ============================================================
    // CLASS OPTIONS HTML (for static HTML generation)
    // ============================================================

    /**
     * Get HTML for class options.
     * Used for static HTML generation.
     * 
     * @param {string} selectedId - Selected class ID
     * @param {Array} excludeIds - Class IDs to exclude (already assigned)
     * @returns {string} HTML string of options
     */
    function getClassOptionsHTML(selectedId, excludeIds) {
        excludeIds = excludeIds || [];
        var classes = ClassesQueries.getClasses();
        var html = '<option value="">None</option>';

        var sorted = classes.slice().sort(function(a, b) {
            return (a.name || '').localeCompare(b.name || '');
        });

        sorted.forEach(function(cls) {
            if (!cls) return;

            var isExcluded = excludeIds.some(function(id) {
                return String(id) === String(cls.id);
            });

            if (isExcluded) return;

            var isSelected = selectedId !== undefined &&
                selectedId !== null &&
                String(cls.id) === String(selectedId);

            html += '<option value="' + DomUtils.escapeHtml(cls.id) + '" ' +
                (isSelected ? 'selected' : '') + '>' +
                DomUtils.escapeHtml(cls.name) + '</option>';
        });

        return html;
    }

    /**
     * Get HTML for class options excluding a character's current classes.
     * 
     * @param {object} char - Character object
     * @param {string} selectedId - Selected class ID
     * @returns {string} HTML string of options
     */
    function getAvailableClassOptionsHTML(char, selectedId) {
        var excludeIds = (char && Array.isArray(char.classIds)) ? char.classIds : [];
        return getClassOptionsHTML(selectedId, excludeIds);
    }

    // ============================================================
    // CHARACTER CLASS INFO
    // ============================================================

    /**
     * Get the class names for a character.
     * 
     * @param {object} char - Character object
     * @returns {string[]} Array of class names
     */
    function getCharacterClassNames(char) {
        if (!char) return [];

        var classIds = getNormalisedClassIds(char);
        if (classIds.length === 0) return [];

        var classes = ClassesQueries.getClasses();
        var names = [];

        classIds.forEach(function(cid) {
            var cls = classes.find(function(c) {
                return c && String(c.id) === String(cid);
            });
            if (cls) {
                names.push(cls.name);
            }
        });

        return names;
    }

    /**
     * Check if a character is in a class.
     * 
     * @param {object} char - Character object
     * @param {string} classId - Class ID
     * @returns {boolean} True if character is in class
     */
    function isCharacterInClass(char, classId) {
        if (!char || !classId) return false;

        var classIds = getNormalisedClassIds(char);
        return classIds.some(function(cid) {
            return String(cid) === String(classId);
        });
    }

    /**
     * Get the number of classes a character is in.
     * 
     * @param {object} char - Character object
     * @returns {number} Number of classes
     */
    function getClassCount(char) {
        if (!char) return 0;
        return getNormalisedClassIds(char).length;
    }

    // ============================================================
    // ACADEMIC CLASS VIEW
    // ============================================================

    /**
     * Render the academic class view for a character.
     * 
     * @param {object} char - Character object
     * @param {HTMLElement} container - Container element (optional)
     */
    function renderAcademicClassView(char, container) {
        if (!container) {
            container = document.getElementById('academic-class-view');
        }
        if (!container) return;

        // Clear container
        container.textContent = '';

        if (!char) {
            var empty = document.createElement('p');
            empty.className = 'empty-state';
            empty.style.cssText = 'padding:8px;font-size:0.8rem;';
            empty.textContent = 'Select a character to view classes.';
            container.appendChild(empty);
            return;
        }

        var classIds = getNormalisedClassIds(char);
        var classes = ClassesQueries.getClasses();

        if (classIds.length === 0) {
            var empty = document.createElement('p');
            empty.className = 'empty-state';
            empty.style.cssText = 'padding:8px;font-size:0.8rem;';
            empty.textContent = 'No classes assigned.';
            container.appendChild(empty);
            return;
        }

        // Create class list
        var list = document.createElement('div');
        list.style.cssText = 'display:flex;flex-direction:column;gap:4px;';

        classIds.forEach(function(cid) {
            var cls = classes.find(function(c) {
                return c && String(c.id) === String(cid);
            });

            if (!cls) return;

            var item = document.createElement('div');
            item.style.cssText = 'padding:4px 8px;background:var(--bg);border-radius:4px;border-left:3px solid var(--accent);display:flex;justify-content:space-between;align-items:center;';

            var nameSpan = document.createElement('span');
            nameSpan.style.cssText = 'font-size:0.75rem;';
            nameSpan.textContent = cls.name;
            item.appendChild(nameSpan);

            list.appendChild(item);
        });

        container.appendChild(list);
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.CharacterClassView = {
        // Class tags
        renderClassTags: renderClassTags,
        createClassTag: createClassTag,
        clearClassTags: clearClassTags,
        getClassTagIds: getClassTagIds,

        // Selectors
        populateClassSelector: populateClassSelector,
        populateClassFilter: populateClassFilter,

        // Display
        updateCurrentClassesDisplay: updateCurrentClassesDisplay,
        getCurrentClassesDisplayText: getCurrentClassesDisplayText,

        // Options HTML
        getClassOptionsHTML: getClassOptionsHTML,
        getAvailableClassOptionsHTML: getAvailableClassOptionsHTML,

        // Character class info
        getCharacterClassNames: getCharacterClassNames,
        isCharacterInClass: isCharacterInClass,
        getClassCount: getClassCount,
        getNormalisedClassIds: getNormalisedClassIds,

        // Views
        renderAcademicClassView: renderAcademicClassView,

        // Helpers
        createEmptyState: createEmptyState
    };

})();