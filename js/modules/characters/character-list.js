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
 *   - Uses CharacterAggregator for cross-domain data (list view model)
 *   - Uses CharacterQueries for simple character data
 *   - Uses DomUtils for safe DOM operations
 *   - Uses State for current week (delegates to CalendarConstants)
 * 
 * DEPENDENCIES:
 *   - window.CharacterAggregator (from character-aggregator.js) - MANDATORY
 *   - window.CharacterQueries (from character-queries.js) - MANDATORY
 *   - window.DomUtils (from dom-utils.js) - MANDATORY
 *   - window.getCurrentEditId (from index.js) - MANDATORY
 *   - window.CALENDAR_CONSTANTS (from constants.js) - MANDATORY
 */

(function() {
    'use strict';

    if (window.__characterListLoaded) {
        return;
    }
    window.__characterListLoaded = true;

    // ============================================================
    // DEPENDENCY IMPORTS
    // ============================================================

    var CharacterAggregator = window.CharacterAggregator;
    var CharacterQueries = window.CharacterQueries;
    var DomUtils = window.DomUtils;
    var CalendarConstants = window.CALENDAR_CONSTANTS;

    // ============================================================
    // DEPENDENCY CHECK - MANDATORY (no fallbacks)
    // ============================================================

    function checkDependencies() {
        var missing = [];

        if (!CharacterAggregator || typeof CharacterAggregator.getCharacterListViewModel !== 'function') {
            missing.push('CharacterAggregator.getCharacterListViewModel');
        }

        if (!CharacterQueries || typeof CharacterQueries.getDisplayName !== 'function') {
            missing.push('CharacterQueries.getDisplayName');
        }
        if (!CharacterQueries || typeof CharacterQueries.getCharacterById !== 'function') {
            missing.push('CharacterQueries.getCharacterById');
        }
        if (!CharacterQueries || typeof CharacterQueries.getCurrentStatus !== 'function') {
            missing.push('CharacterQueries.getCurrentStatus');
        }

        if (!DomUtils || typeof DomUtils.escapeHtml !== 'function') {
            missing.push('DomUtils.escapeHtml');
        }

        if (typeof window.getCurrentEditId !== 'function') {
            missing.push('getCurrentEditId');
        }

        if (missing.length > 0) {
            throw new Error('[CharacterList] Missing dependencies: ' + missing.join(', '));
        }

        return true;
    }

    checkDependencies();

    // ============================================================
    // HTML ESCAPING - Delegates to DomUtils
    // ============================================================

    function escapeHtml(value) {
        return DomUtils.escapeHtml(value);
    }

    // ============================================================
    // CONSTANTS
    // ============================================================

    var MIN_WEEK = CalendarConstants ? CalendarConstants.MIN_WEEK : 1;
    var MAX_WEEK = CalendarConstants ? CalendarConstants.MAX_WEEK : 52;
    var DEFAULT_WEEK = 1;

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
        var data = window.data || {};
        var week = data.currentWeek;
        if (typeof week === 'number' && week >= MIN_WEEK && week <= MAX_WEEK) {
            return week;
        }
        return DEFAULT_WEEK;
    }

    // ============================================================
    // RENDER CHARACTER LIST
    // ============================================================

    function render() {
        var container = document.getElementById('characters-container');
        if (!container) {
            return;
        }

        var filters = getFilterValues();
        var currentWeek = getCurrentWeek();

        // Use CharacterAggregator for cross-domain data
        var items = CharacterAggregator.getCharacterListViewModel({
            classFilter: filters.classId,
            nameFilter: filters.name,
            hideDeceased: filters.hideDeceased,
            hideEliminated: filters.hideEliminated,
            week: currentWeek
        });

        if (items.length === 0) {
            container.innerHTML = '<p class="empty-state">No characters found.</p>';
            return;
        }

        var currentEditId = typeof window.getCurrentEditId === 'function' ? window.getCurrentEditId() : null;

        var html = '';
        for (var i = 0; i < items.length; i++) {
            var item = items[i];
            var isSelected = String(item.id) === String(currentEditId);

            var safeId = escapeHtml(item.id);
            var safeName = escapeHtml(item.name);
            var safeStatus = escapeHtml(item.status);

            html += '<div class="char-list-item' + (isSelected ? ' selected' : '') + '" data-id="' + safeId + '" style="padding:4px 6px;border-bottom:1px solid var(--border-soft);cursor:pointer;' +
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
                    elimText += ' Wk' + item.eliminationWeek;
                }
                badges.push('<span style="font-size:0.5rem;color:var(--warning);">' + elimText + '</span>');
            }
            if (item.classNames && item.classNames.length > 0) {
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
    // POPULATE CLASS FILTER
    // ============================================================

    function populateClassFilter() {
        var select = document.getElementById('char-class-filter');
        if (!select) {
            return;
        }

        var previousValue = select.value;

        // Use CharacterQueries for classes (simple read, no aggregation needed)
        var classes = window.AcademyQueries ? window.AcademyQueries.getClasses() : [];

        select.innerHTML = '<option value="all">All Classes</option>';

        for (var i = 0; i < classes.length; i++) {
            var cls = classes[i];
            if (!cls || typeof cls !== 'object') {
                continue;
            }
            var option = document.createElement('option');
            option.value = cls.id;
            option.textContent = cls.name;
            select.appendChild(option);
        }

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
    // GET FILTER VALUES (public for other modules)
    // ============================================================

    function getFilterValuesPublic() {
        return getFilterValues();
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.CharacterList = {
        render: render,
        populateClassFilter: populateClassFilter,
        getFilterValues: getFilterValuesPublic
    };

})();
