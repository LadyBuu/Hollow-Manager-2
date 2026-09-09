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
 *   - Uses LAZY LOADING for CharacterAggregator
 *   - Uses LAZY LOADING for getCurrentEditId
 *   - Uses CharacterQueries for simple character data
 *   - Uses DomUtils for safe DOM operations
 *   - Uses State for current week (delegates to CalendarConstants)
 * 
 * DEPENDENCIES (lazily loaded):
 *   - window.CharacterAggregator (from character-aggregator.js)
 *   - window.CharacterQueries (from character-queries.js)
 *   - window.DomUtils (from dom-utils.js)
 *   - window.getCurrentEditId (from index.js)
 *   - window.CALENDAR_CONSTANTS (from constants.js)
 *   - window.AcademyQueries (from academy-queries.js)
 */

(function() {
    'use strict';

    // Guard against duplicate loading
    if (window.__characterListLoaded) {
        return;
    }
    window.__characterListLoaded = true;

    // ============================================================
    // LAZY LOADING HELPERS - Breaks circular dependencies
    // ============================================================

    function getCharacterAggregator() {
        return window.CharacterAggregator || null;
    }

    function getCharacterQueries() {
        return window.CharacterQueries || null;
    }

    function getDomUtils() {
        return window.DomUtils || null;
    }

    function getAcademyQueries() {
        return window.AcademyQueries || null;
    }

    function getCalendarConstants() {
        return window.CALENDAR_CONSTANTS || window.CalendarConstants || null;
    }

    /**
     * Get the current edit ID from the global state.
     * This is lazily loaded from characters/index.js
     * 
     * @returns {string|null} Current edit ID or null
     */
    function getCurrentEditId() {
        if (typeof window.getCurrentEditId === 'function') {
            return window.getCurrentEditId();
        }
        // Try to get from global state
        if (window._currentEditId !== undefined) {
            return window._currentEditId;
        }
        return null;
    }

    // ============================================================
    // DEPENDENCY CHECK - Warns but doesn't fail
    // ============================================================

    function checkDependencies() {
        var missing = [];

        if (!getCharacterAggregator()) {
            missing.push('CharacterAggregator (lazy)');
        }
        if (!getCharacterQueries()) {
            missing.push('CharacterQueries (lazy)');
        }
        if (!getDomUtils()) {
            missing.push('DomUtils (lazy)');
        }

        // getCurrentEditId is lazily loaded from index.js
        if (typeof window.getCurrentEditId !== 'function' && window._currentEditId === undefined) {
            missing.push('getCurrentEditId (lazy)');
        }

        if (missing.length > 0) {
            console.warn('[CharacterList] Some dependencies not yet loaded:', missing.join(', '));
            return false;
        }

        return true;
    }

    // Run check but don't fail - will check again on each render
    checkDependencies();

    // ============================================================
    // HTML ESCAPING - Delegates to DomUtils
    // ============================================================

    function escapeHtml(value) {
        var DomUtils = getDomUtils();
        if (DomUtils && typeof DomUtils.escapeHtml === 'function') {
            return DomUtils.escapeHtml(value);
        }
        // Fallback
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
    // CONSTANTS - Lazy loaded from CalendarConstants
    // ============================================================

    function getConstants() {
        var CC = getCalendarConstants();
        if (CC) {
            return {
                MIN_WEEK: CC.MIN_WEEK || 1,
                MAX_WEEK: CC.MAX_WEEK || 52,
                DEFAULT_WEEK: 1
            };
        }
        return {
            MIN_WEEK: 1,
            MAX_WEEK: 52,
            DEFAULT_WEEK: 1
        };
    }

    // ============================================================
    // FILTER HELPERS
    // ============================================================

    function getFilterValues() {
        var nameFilter = document.getElementById('char-name-filter');
        var classFilter = document.getElementById('char-class-filter');
        var hideDeceased = document.getElementById('hide-deceased');
        var hideEliminated = document.getElementById('hide-eliminated');

        return {
            name: nameFilter ? nameFilter.value : '',
            classId: classFilter ? classFilter.value : 'all',
            hideDeceased: hideDeceased ? hideDeceased.checked : true,
            hideEliminated: hideEliminated ? hideEliminated.checked : true
        };
    }

    function getCurrentWeek() {
        var constants = getConstants();
        var data = window.data || {};
        var week = data.currentWeek;
        if (typeof week === 'number' && week >= constants.MIN_WEEK && week <= constants.MAX_WEEK) {
            return week;
        }
        return constants.DEFAULT_WEEK;
    }

    // ============================================================
    // POPULATE CLASS FILTER - Uses AcademyQueries
    // ============================================================

    function populateClassFilter() {
        var select = document.getElementById('char-class-filter');
        if (!select) {
            return;
        }

        var previousValue = select.value;
        var AcademyQueries = getAcademyQueries();

        // Use AcademyQueries for classes if available
        var classes = [];
        if (AcademyQueries && typeof AcademyQueries.getClasses === 'function') {
            classes = AcademyQueries.getClasses() || [];
        } else if (window.AcademyQueries && typeof window.AcademyQueries.getClasses === 'function') {
            classes = window.AcademyQueries.getClasses() || [];
        }

        select.innerHTML = '<option value="all">All Classes</option>';

        for (var i = 0; i < classes.length; i++) {
            var cls = classes[i];
            if (!cls || typeof cls !== 'object') {
                continue;
            }
            var option = document.createElement('option');
            option.value = cls.id;
            option.textContent = cls.name || 'Unknown Class';
            select.appendChild(option);
        }

        // Restore previous selection if it still exists
        if (previousValue && previousValue !== 'all') {
            var exists = false;
            for (var j = 0; j < select.options.length; j++) {
                if (select.options[j].value === previousValue) {
                    exists = true;
                    break;
                }
            }
            if (exists) {
                select.value = previousValue;
            } else {
                select.value = 'all';
            }
        } else {
            select.value = 'all';
        }
    }

    // ============================================================
    // RENDER CHARACTER LIST
    // ============================================================

    function render() {
        var container = document.getElementById('characters-container');
        if (!container) {
            return;
        }

        var CharacterAggregator = getCharacterAggregator();
        var CharacterQueries = getCharacterQueries();

        if (!CharacterAggregator || !CharacterQueries) {
            container.innerHTML = '<p class="empty-state">Character data not available. Please refresh the page.</p>';
            return;
        }

        var filters = getFilterValues();
        var currentWeek = getCurrentWeek();

        // Use CharacterAggregator for cross-domain data
        var items = [];
        try {
            items = CharacterAggregator.getCharacterListViewModel({
                classFilter: filters.classId,
                nameFilter: filters.name,
                hideDeceased: filters.hideDeceased,
                hideEliminated: filters.hideEliminated,
                week: currentWeek
            });
        } catch (e) {
            console.warn('[CharacterList] Error getting list view model:', e);
            container.innerHTML = '<p class="empty-state">Error loading character list.</p>';
            return;
        }

        // Ensure items is an array
        if (!Array.isArray(items)) {
            items = [];
        }

        if (items.length === 0) {
            container.innerHTML = '<p class="empty-state">No characters found.</p>';
            return;
        }

        var currentEditId = getCurrentEditId();

        var html = '';
        for (var i = 0; i < items.length; i++) {
            var item = items[i];
            if (!item || typeof item !== 'object') {
                continue;
            }

            var isSelected = currentEditId !== null && String(item.id) === String(currentEditId);

            var safeId = escapeHtml(item.id);
            var safeName = escapeHtml(item.name || 'Unknown');
            var safeStatus = escapeHtml(item.status || '');

            var selectedClass = isSelected ? ' selected' : '';
            var deceasedClass = item.deceased ? ' deceased' : '';
            var eliminatedClass = item.eliminated ? ' eliminated' : '';

            html += '<div class="char-list-item' + selectedClass + deceasedClass + eliminatedClass + '" data-id="' + safeId + '" style="padding:4px 6px;border-bottom:1px solid var(--border-soft);cursor:pointer;' +
                (isSelected ? 'background:var(--accent-soft);border-left:3px solid var(--accent);' : '') +
                (item.deceased ? 'opacity:0.4;' : '') + '">';

            html += '<div style="display:flex;justify-content:space-between;align-items:center;">';
            html += '<span style="font-size:0.75rem;">' + safeName + '</span>';
            html += '<span style="font-size:0.55rem;color:var(--text-dim);">' + safeStatus + '</span>';
            html += '</div>';

            var badges = [];
            if (item.deceased) {
                badges.push('<span style="font-size:0.5rem;color:var(--danger);">Deceased</span>');
            }
            if (item.eliminated) {
                var elimText = 'Eliminated';
                if (item.eliminationWeek) {
                    elimText += ' Wk' + escapeHtml(item.eliminationWeek);
                }
                badges.push('<span style="font-size:0.5rem;color:var(--warning);">' + elimText + '</span>');
            }
            if (item.classNames && Array.isArray(item.classNames) && item.classNames.length > 0) {
                var classBadges = item.classNames.map(function(name) {
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
    // GET FILTER VALUES (public for other modules)
    // ============================================================

    function getFilterValuesPublic() {
        return getFilterValues();
    }

    // ============================================================
    // REFRESH - Re-render with current data
    // ============================================================

    function refresh() {
        render();
    }

    // ============================================================
    // DESTROY - Clean up (minimal for this module)
    // ============================================================

    function destroy() {
        // No event listeners to clean up in this module
        // But we can clear the container
        var container = document.getElementById('characters-container');
        if (container) {
            container.innerHTML = '';
        }
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.CharacterList = {
        render: render,
        refresh: refresh,
        destroy: destroy,
        populateClassFilter: populateClassFilter,
        getFilterValues: getFilterValuesPublic,
        getCurrentEditId: getCurrentEditId
    };

    // ============================================================
    // VERIFICATION
    // ============================================================

    (function verify() {
        var exports = window.CharacterList;
        var missing = [];

        var required = [
            'render',
            'refresh',
            'destroy',
            'populateClassFilter',
            'getFilterValues'
        ];

        for (var i = 0; i < required.length; i++) {
            if (typeof exports[required[i]] !== 'function') {
                missing.push(required[i]);
            }
        }

        if (missing.length > 0) {
            console.warn('[CharacterList] Verification - some exports may be missing:', missing.join(', '));
        } else {
            console.log('[CharacterList] All exports verified successfully.');
        }
    })();

})();
