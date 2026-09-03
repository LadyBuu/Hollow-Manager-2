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
 *   - Uses CoreUtils for data queries
 *   - Uses DomUtils for safe DOM operations
 * 
 * DEPENDENCIES:
 *   - window.CoreUtils (from core-utils.js)
 *   - window.DomUtils (from dom-utils.js)
 *   - window.getCurrentEditId (from index.js)
 *   - window.CharacterEliminations (from character-eliminations.js)
 */

(function() {
    'use strict';

    // Guard against duplicate loading
    if (window.__characterListLoaded) {
        return;
    }
    window.__characterListLoaded = true;

    // ============================================================
    // DEPENDENCY CHECK
    // ============================================================

    function checkDependencies() {
        var missing = [];

        if (!window.CoreUtils || typeof window.CoreUtils.getDisplayName !== 'function') {
            missing.push('CoreUtils.getDisplayName');
        }

        if (!window.CoreUtils || typeof window.CoreUtils.getCharacterById !== 'function') {
            missing.push('CoreUtils.getCharacterById');
        }

        if (!window.CoreUtils || typeof window.CoreUtils.getCurrentStatus !== 'function') {
            missing.push('CoreUtils.getCurrentStatus');
        }

        if (!window.DomUtils || typeof window.DomUtils.escapeHtml !== 'function') {
            missing.push('DomUtils.escapeHtml');
        }

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
    // STATE
    // ============================================================

    var _filterDebounceTimer = null;

    // ============================================================
    // HELPERS
    // ============================================================

    function escapeHtml(value) {
        if (window.DomUtils && typeof window.DomUtils.escapeHtml === 'function') {
            return window.DomUtils.escapeHtml(value);
        }

        if (value === undefined || value === null) {
            return '';
        }
        var str = String(value);
        return str
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

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

        var name = window.CoreUtils.getDisplayName(char).toLowerCase();
        if (filters.name && name.indexOf(filters.name) === -1) {
            return false;
        }

        // Class filter
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

        // Hide eliminated
        if (filters.hideEliminated) {
            var currentWeek = window.data && window.data.currentWeek ? window.data.currentWeek : 1;
            if (window.CharacterEliminations && 
                typeof window.CharacterEliminations.isCharacterEliminatedByWeek === 'function') {
                if (window.CharacterEliminations.isCharacterEliminatedByWeek(char, currentWeek)) {
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
        var filtered = characters.filter(function(char) {
            return characterMatchesFilters(char, filters);
        });

        // Sort by display name
        filtered.sort(function(a, b) {
            var nameA = window.CoreUtils.getDisplayName(a);
            var nameB = window.CoreUtils.getDisplayName(b);
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
            var displayName = window.CoreUtils.getDisplayName(char);
            var status = window.CoreUtils.getCurrentStatus(char);
            var isDeceased = char.deceased || false;

            // Check if eliminated
            var isEliminated = false;
            if (window.CharacterEliminations && 
                typeof window.CharacterEliminations.isCharacterEliminatedByWeek === 'function') {
                isEliminated = window.CharacterEliminations.isCharacterEliminatedByWeek(char, currentWeek);
            }

            // Get class names
            var classNames = [];
            if (window.CoreUtils && typeof window.CoreUtils.getCharacterClassNames === 'function') {
                classNames = window.CoreUtils.getCharacterClassNames(char);
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
    // POPULATE CLASS FILTER
    // ============================================================

    function populateClassFilter() {
        var select = document.getElementById('char-class-filter');
        if (!select) return;

        var classes = [];
        if (window.CoreUtils && typeof window.CoreUtils.getClasses === 'function') {
            classes = window.CoreUtils.getClasses();
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
