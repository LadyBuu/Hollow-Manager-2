/**
 * modules/characters/character-list.js - Character List
 * Renders the character list with filtering
 * Path: js/modules/characters/character-list.js
 * 
 * This module is responsible for:
 *   - Rendering the character list
 *   - Filtering characters by name, class, deceased status, elimination status
 *   - Sorting characters by name
 *   - Displaying character status badges (deceased, eliminated, class)
 *   - Handling character selection (delegates to index.js)
 * 
 * IMPORTANT:
 *   - RENDER ONLY - no event binding (handled by character-events.js)
 *   - No data mutations
 *   - No persistence calls
 *   - USES CharacterQueries for character data queries
 *   - USES ClassesQueries for class-related queries
 *   - USES Elimination for elimination status
 *   - USES DomUtils for safe DOM operations
 * 
 * DEPENDENCIES:
 *   - window.CharacterQueries (from character-queries.js)
 *   - window.ClassesQueries (from classes-queries.js)
 *   - window.Elimination (from elimination.js)
 *   - window.DomUtils (from dom-utils.js)
 *   - window.getCurrentEditId (from index.js)
 *   - window.CALENDAR_CONSTANTS (from constants.js)
 */

(function() {
    'use strict';

    // Guard against duplicate loading
    if (window.__characterListLoaded) {
        return;
    }
    window.__characterListLoaded = true;

    // ============================================================
    // DEPENDENCY IMPORTS
    // ============================================================

    var CharacterQueries = window.CharacterQueries || window;
    var ClassesQueries = window.ClassesQueries || window;
    var Elimination = window.Elimination || window;
    var DomUtils = window.DomUtils || window;
    var CalendarConstants = window.CALENDAR_CONSTANTS || {};

    // ============================================================
    // CONSTANTS
    // ============================================================

    var MIN_WEEK = CalendarConstants.MIN_WEEK || 1;
    var MAX_WEEK = CalendarConstants.MAX_WEEK || 52;

    // ============================================================
    // DEPENDENCY CHECK
    // ============================================================

    function checkDependencies() {
        var missing = [];

        // CharacterQueries is MANDATORY
        if (!CharacterQueries || typeof CharacterQueries.getDisplayName !== 'function') {
            missing.push('CharacterQueries.getDisplayName');
        }
        if (!CharacterQueries || typeof CharacterQueries.getCharacterById !== 'function') {
            missing.push('CharacterQueries.getCharacterById');
        }
        if (!CharacterQueries || typeof CharacterQueries.getCurrentStatus !== 'function') {
            missing.push('CharacterQueries.getCurrentStatus');
        }

        // ClassesQueries is MANDATORY
        if (!ClassesQueries || typeof ClassesQueries.getCharacterClassNames !== 'function') {
            missing.push('ClassesQueries.getCharacterClassNames');
        }

        // DomUtils is MANDATORY
        if (!DomUtils || typeof DomUtils.escapeHtml !== 'function') {
            missing.push('DomUtils.escapeHtml');
        }

        // getCurrentEditId is MANDATORY
        if (typeof window.getCurrentEditId !== 'function') {
            missing.push('getCurrentEditId');
        }

        if (missing.length > 0) {
            console.warn('CharacterList: Missing dependencies:', missing.join(', '));
            return false;
        }
        return true;
    }

    // ============================================================
    // HTML ESCAPING - Delegates to DomUtils (SINGLE SOURCE OF TRUTH)
    // ============================================================

    function escapeHtml(value) {
        if (DomUtils && typeof DomUtils.escapeHtml === 'function') {
            return DomUtils.escapeHtml(value);
        }
        // Emergency fallback (should never be reached)
        if (value === undefined || value === null) {
            return '';
        }
        return String(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;')
            .replace(/`/g, '&#x60;');
    }

    // ============================================================
    // STATE
    // ============================================================

    var _filterDebounceTimer = null;

    // ============================================================
    // FILTER HELPERS
    // ============================================================

    function getFilterValues() {
        var nameFilter = document.getElementById('char-name-filter');
        var classFilter = document.getElementById('char-class-filter');
        var hideDeceased = document.getElementById('hide-deceased');
        var hideEliminated = document.getElementById('hide-eliminated');

        return {
            name: nameFilter ? nameFilter.value.toLowerCase() : '',
            classId: classFilter ? classFilter.value : 'all',
            hideDeceased: hideDeceased ? hideDeceased.checked : true,
            hideEliminated: hideEliminated ? hideEliminated.checked : true
        };
    }

    function characterMatchesFilters(char, filters) {
        if (!char) return false;

        // Name filter
        var name = CharacterQueries.getDisplayName(char).toLowerCase();
        if (filters.name && name.indexOf(filters.name) === -1) {
            return false;
        }

        // Class filter - use ClassesQueries
        if (filters.classId !== 'all' && filters.classId !== '') {
            var classIds = Array.isArray(char.classIds) ? char.classIds : [];
            if (!classIds.some(function(cid) { return String(cid) === String(filters.classId); })) {
                return false;
            }
        }

        // Hide deceased
        if (filters.hideDeceased && char.deceased) {
            return false;
        }

        // Hide eliminated - use Elimination module
        if (filters.hideEliminated) {
            var currentWeek = window.data && window.data.currentWeek ? window.data.currentWeek : 1;
            if (Elimination && typeof Elimination.isCharacterEliminated === 'function') {
                if (Elimination.isCharacterEliminated(char.id, currentWeek)) {
                    return false;
                }
            }
        }

        return true;
    }

    // ============================================================
    // RENDER CHARACTER LIST
    // ============================================================

    function render() {
        if (!checkDependencies()) {
            var container = document.getElementById('characters-container');
            if (container) {
                container.innerHTML = '<p class="empty-state">Character list dependencies not loaded.</p>';
            }
            return;
        }

        var container = document.getElementById('characters-container');
        if (!container) {
            console.warn('CharacterList: Container not found');
            return;
        }

        var data = window.data || {};
        var characters = Array.isArray(data.characters) ? data.characters : [];
        var filters = getFilterValues();

        // Filter characters
        var filtered = [];
        for (var i = 0; i < characters.length; i++) {
            var char = characters[i];
            if (characterMatchesFilters(char, filters)) {
                filtered.push(char);
            }
        }

        // Sort by display name (using CharacterQueries)
        filtered.sort(function(a, b) {
            var nameA = CharacterQueries.getDisplayName(a);
            var nameB = CharacterQueries.getDisplayName(b);
            return nameA.localeCompare(nameB);
        });

        if (filtered.length === 0) {
            container.innerHTML = '<p class="empty-state">No characters found.</p>';
            return;
        }

        var currentEditId = typeof window.getCurrentEditId === 'function' ? window.getCurrentEditId() : null;
        var currentWeek = window.data && window.data.currentWeek ? window.data.currentWeek : 1;

        var html = '';
        for (var i = 0; i < filtered.length; i++) {
            var char = filtered[i];
            var isSelected = String(char.id) === String(currentEditId);

            // Use CharacterQueries for display name and status
            var displayName = CharacterQueries.getDisplayName(char);
            var status = CharacterQueries.getCurrentStatus(char);
            var isDeceased = char.deceased || false;

            // Check if eliminated - use Elimination module
            var isEliminated = false;
            if (Elimination && typeof Elimination.isCharacterEliminated === 'function') {
                isEliminated = Elimination.isCharacterEliminated(char.id, currentWeek);
            }

            // Get class names - use ClassesQueries
            var classNames = [];
            if (ClassesQueries && typeof ClassesQueries.getCharacterClassNames === 'function') {
                classNames = ClassesQueries.getCharacterClassNames(char);
            }

            var safeId = escapeHtml(char.id);
            var safeName = escapeHtml(displayName);
            var safeStatus = escapeHtml(status);

            html += '<div class="char-list-item' + (isSelected ? ' selected' : '') + '" data-id="' + safeId + '" style="padding:4px 6px;border-bottom:1px solid var(--border-soft);cursor:pointer;' + 
                (isSelected ? 'background:var(--accent-soft);border-left:3px solid var(--accent);' : '') +
                (isDeceased ? 'opacity:0.4;' : '') + '">';
            
            html += '<div style="display:flex;justify-content:space-between;align-items:center;">';
            html += '<span style="font-size:0.75rem;">' + safeName + '</span>';
            html += '<span style="font-size:0.55rem;color:var(--text-dim);">' + safeStatus + '</span>';
            html += '</div>';

            // Badges
            var badges = [];
            if (isDeceased) {
                badges.push('<span style="font-size:0.5rem;color:var(--danger);">Deceased</span>');
            }
            if (isEliminated) {
                badges.push('<span style="font-size:0.5rem;color:var(--warning);">Eliminated</span>');
            }
            if (classNames.length > 0) {
                var classBadges = classNames.map(function(name) {
                    return '<span style="font-size:0.5rem;color:var(--accent);">' + escapeHtml(name) + '</span>';
                }).join(' ');
                badges.push(classBadges);
            }

            if (badges.length > 0) {
                html += '<div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:2px;">' + badges.join(' ') + '</div>';
            }

            html += '</div>';
        }

        container.innerHTML = html;
    }

    // ============================================================
    // POPULATE CLASS FILTER - Uses ClassesQueries
    // ============================================================

    function populateClassFilter() {
        var select = document.getElementById('char-class-filter');
        if (!select) return;

        var classes = [];
        if (ClassesQueries && typeof ClassesQueries.getClasses === 'function') {
            classes = ClassesQueries.getClasses();
        }

        select.innerHTML = '<option value="all">All Classes</option>';

        for (var i = 0; i < classes.length; i++) {
            var cls = classes[i];
            if (!cls || typeof cls !== 'object') continue;
            var option = document.createElement('option');
            option.value = cls.id;
            option.textContent = cls.name;
            select.appendChild(option);
        }
    }

    // ============================================================
    // EXPOSE - Public API
    // ============================================================

    window.CharacterList = {
        render: render,
        populateClassFilter: populateClassFilter
    };

})();
