/**
 * modules/characters/character-list.js - Character List
 * Renders the character list with filtering and sorting.
 *
 * Path: js/modules/characters/character-list.js
 *
 * RESPONSIBILITIES:
 *   - Render the character list.
 *   - Read filter controls from the DOM.
 *   - Persist the sort and hide-filler toggles in sessionStorage.
 *   - Hand filter values to CharacterAggregator; render the result.
 *
 * FILTERS:
 *   - Name (substring, case-insensitive)
 *   - Class (dropdown; includes the __no_class__ sentinel)
 *   - Career status (checkboxes, OR-combined)
 *   - Hide deceased
 *   - Hide eliminated
 *   - Hide filler (sessionStorage-persisted)
 *
 * SORT:
 *   - name-asc (default), name-desc, age-asc, age-desc
 *   - sessionStorage-persisted under characters_sort_v1
 *   - Sort is NOT reset by the Clear filter button
 *
 * CLASS FILTER (__no_class__):
 *   The sentinel value '__no_class__' matches characters with no
 *   class entries, or with classIds that resolve to no live class.
 *   The set of live classes is owned by AcademyClasses. If that
 *   module is unavailable, the aggregator fails the projection
 *   rather than guessing.
 *
 * DEPENDENCIES (lazily loaded):
 *   - window.CharacterAggregator
 *   - window.CharacterQueries
 *   - window.DomUtils
 *   - window.AcademyClasses
 *   - window.CalendarConstants
 *   - window.getCurrentEditId (from index.js) — resolved per render
 */

(function() {
    'use strict';

    if (window.__characterListLoaded) {
        return;
    }
    window.__characterListLoaded = true;

    // ============================================================
    // CONSTANTS
    // ============================================================

    var HIDE_FILLER_STORAGE_KEY = 'characters_hide_filler_v1';
    var SORT_STORAGE_KEY = 'characters_sort_v1';

    var NO_CLASS_FILTER = '__no_class__';

    var DEFAULT_SORT = 'name-asc';

    var VALID_SORTS = {
        'name-asc': true,
        'name-desc': true,
        'age-asc': true,
        'age-desc': true
    };

    // ============================================================
    // LAZY DEPENDENCIES
    // ============================================================

    function getCharacterAggregator() { return window.CharacterAggregator || null; }
    function getCharacterQueries() { return window.CharacterQueries || null; }
    function getDomUtils() { return window.DomUtils || null; }
    function getAcademyClasses() { return window.AcademyClasses || null; }
    function getCalendarConstants() { return window.CalendarConstants || null; }

    function getCurrentEditId() {
        if (typeof window.getCurrentEditId === 'function') {
            return window.getCurrentEditId();
        }
        if (window._currentEditId !== undefined) {
            return window._currentEditId;
        }
        return null;
    }

    // ============================================================
    // STORAGE
    // ============================================================
    //
    // Both toggles persist in sessionStorage. Defaults are used when
    // storage is unavailable or the stored value is invalid.

    function readStoredFlag(key, defaultValue) {
        try {
            var raw = sessionStorage.getItem(key);
            if (raw === null) { return defaultValue; }
            return raw !== 'false';
        } catch (e) {
            return defaultValue;
        }
    }

    function writeStoredFlag(key, value) {
        try {
            sessionStorage.setItem(key, value ? 'true' : 'false');
        } catch (e) {
            // Ignore. sessionStorage is a cache.
        }
    }

    function getHideFillerFromStorage() {
        return readStoredFlag(HIDE_FILLER_STORAGE_KEY, true);
    }

    function setHideFillerInStorage(value) {
        writeStoredFlag(HIDE_FILLER_STORAGE_KEY, value);
    }

    function getSortFromStorage() {
        try {
            var raw = sessionStorage.getItem(SORT_STORAGE_KEY);
            if (raw && VALID_SORTS[raw]) {
                return raw;
            }
        } catch (e) {
            // Fall through to default.
        }
        return DEFAULT_SORT;
    }

    function setSortInStorage(value) {
        try {
            sessionStorage.setItem(SORT_STORAGE_KEY, value);
        } catch (e) {
            // Ignore.
        }
    }

    // ============================================================
    // DEPENDENCY CHECK
    // ============================================================

    function checkDependencies() {
        var missing = [];

        if (!getCharacterAggregator()) {
            missing.push('CharacterAggregator');
        }
        if (!getCharacterQueries()) {
            missing.push('CharacterQueries');
        }
        if (!getDomUtils()) {
            missing.push('DomUtils');
        }

        if (missing.length > 0) {
            console.warn(
                '[CharacterList] Dependencies not loaded:',
                missing.join(', ')
            );
            return false;
        }

        return true;
    }

    // ============================================================
    // ESCAPING
    // ============================================================

    function escapeHtml(value) {
        var DomUtils = getDomUtils();
        if (DomUtils && typeof DomUtils.escapeHtml === 'function') {
            return DomUtils.escapeHtml(value);
        }
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
    // FILTER READS
    // ============================================================

    function getStatusFilterValues() {
        var container = document.getElementById('char-status-filter');
        if (!container) {
            return [];
        }

        var checkboxes = container.querySelectorAll(
            'input[type="checkbox"][data-status]'
        );
        var values = [];

        for (var i = 0; i < checkboxes.length; i++) {
            var cb = checkboxes[i];
            if (cb.checked) {
                var raw = cb.dataset ? cb.dataset.status : null;
                if (raw) {
                    values.push(String(raw).toLowerCase().trim());
                }
            }
        }

        return values;
    }

    function getHideFillerFromDOM() {
        var cb = document.getElementById('hide-filler');
        if (!cb) {
            return getHideFillerFromStorage();
        }
        return cb.checked === true;
    }

    function getSortFromDOM() {
        var el = document.getElementById('char-sort');
        if (!el) {
            return getSortFromStorage();
        }
        var value = String(el.value || '');
        if (VALID_SORTS[value]) {
            return value;
        }
        return DEFAULT_SORT;
    }

    function getFilterValues() {
        var nameFilter = document.getElementById('char-name-filter');
        var classFilter = document.getElementById('char-class-filter');
        var hideDeceased = document.getElementById('hide-deceased');
        var hideEliminated = document.getElementById('hide-eliminated');

        return {
            name: nameFilter ? nameFilter.value : '',
            classId: classFilter ? classFilter.value : 'all',
            statusFilter: getStatusFilterValues(),
            hideDeceased: hideDeceased ? hideDeceased.checked : true,
            hideEliminated: hideEliminated ? hideEliminated.checked : true,
            hideFiller: getHideFillerFromDOM(),
            sort: getSortFromDOM()
        };
    }

    function getCurrentWeek() {
        var CC = getCalendarConstants();
        var data = window.data || {};
        var week = data.currentWeek;

        var minWeek = CC ? CC.MIN_WEEK || 1 : 1;
        var maxWeek = CC ? CC.MAX_WEEK || 52 : 52;

        if (typeof week === 'number' && week >= minWeek && week <= maxWeek) {
            return week;
        }
        return 1;
    }

    // ============================================================
    // CLASS FILTER POPULATION
    // ============================================================
    //
    // Delegates to CharacterClassView.populateClassFilter if
    // available, so the sentinel option and preservation logic live
    // in one place. Falls back to a local implementation only when
    // the class view module is not loaded.

    function populateClassFilter() {
        var ClassView = window.CharacterClassView;
        if (ClassView &&
            typeof ClassView.populateClassFilter === 'function') {
            ClassView.populateClassFilter();
            return;
        }

        var select = document.getElementById('char-class-filter');
        if (!select) { return; }

        var previousValue = select.value || 'all';

        var AcademyClasses = getAcademyClasses();
        var classes = [];
        if (AcademyClasses &&
            typeof AcademyClasses.getClasses === 'function') {
            classes = AcademyClasses.getClasses() || [];
        }

        var sorted = classes.slice().sort(function(a, b) {
            return (a.name || '').localeCompare(b.name || '');
        });

        var html = '';
        html += '<option value="all">All Classes</option>';
        html += '<option value="' + NO_CLASS_FILTER + '">No Class</option>';

        for (var i = 0; i < sorted.length; i++) {
            var cls = sorted[i];
            if (!cls || !cls.id) { continue; }
            html += '<option value="' +
                        escapeHtml(cls.id) + '">' +
                        escapeHtml(cls.name || 'Unnamed Class') +
                    '</option>';
        }

        select.innerHTML = html;

        var stillExists = false;
        for (var j = 0; j < select.options.length; j++) {
            if (select.options[j].value === previousValue) {
                stillExists = true;
                break;
            }
        }
        select.value = stillExists ? previousValue : 'all';
    }

    // ============================================================
    // RENDER
    // ============================================================

    function render() {
        var container = document.getElementById('characters-container');
        if (!container) { return; }

        if (!checkDependencies()) {
            container.innerHTML =
                '<p class="empty-state">' +
                    'Character data not available. Please refresh the page.' +
                '</p>';
            return;
        }

        var CharacterAggregator = getCharacterAggregator();
        var filters = getFilterValues();
        var currentWeek = getCurrentWeek();

        var items;
        try {
            items = CharacterAggregator.getCharacterListViewModel({
                classFilter: filters.classId,
                statusFilter: filters.statusFilter,
                nameFilter: filters.name,
                hideDeceased: filters.hideDeceased,
                hideEliminated: filters.hideEliminated,
                hideFiller: filters.hideFiller,
                sort: filters.sort,
                week: currentWeek
            });
        } catch (e) {
            console.warn('[CharacterList] Aggregator threw:', e);
            container.innerHTML =
                '<p class="empty-state">Error loading character list.</p>';
            return;
        }

        if (!Array.isArray(items)) {
            container.innerHTML =
                '<p class="empty-state">Error loading character list.</p>';
            return;
        }

        if (items.length === 0) {
            container.innerHTML =
                '<p class="empty-state">No characters found.</p>';
            return;
        }

        var currentEditId = getCurrentEditId();
        var html = '';

        for (var i = 0; i < items.length; i++) {
            html += renderRow(items[i], currentEditId);
        }

        container.innerHTML = html;
    }

    // ============================================================
    // ROW
    // ============================================================

    function renderRow(item, currentEditId) {
        var isSelected = currentEditId !== null &&
            String(item.id) === String(currentEditId);

        var safeId = escapeHtml(item.id);
        var safeName = escapeHtml(item.name || 'Unknown');
        var safeStatus = escapeHtml(item.status || '');

        var nameLine = safeName;
        if (item.ageDisplay) {
            nameLine +=
                ' <span style="color:var(--text-dim);' +
                    'font-size:0.65rem;">(' +
                    escapeHtml(item.ageDisplay) +
                ')</span>';
        }

        var rowClass = 'char-list-item';
        if (isSelected) { rowClass += ' selected'; }
        if (item.deceased) { rowClass += ' deceased'; }
        if (item.eliminated) { rowClass += ' eliminated'; }

        var rowStyle = 'padding:4px 6px;' +
            'border-bottom:1px solid var(--border-soft);' +
            'cursor:pointer;';
        if (isSelected) {
            rowStyle += 'background:var(--accent-soft);' +
                'border-left:3px solid var(--accent);';
        }
        if (item.deceased) {
            rowStyle += 'opacity:0.4;';
        }

        var html = '';
        html += '<div class="' + rowClass + '" ' +
                    'data-id="' + safeId + '" ' +
                    'style="' + rowStyle + '">';

        html += '<div style="display:flex;' +
                    'justify-content:space-between;' +
                    'align-items:center;">';
        html += '<span style="font-size:0.75rem;">' +
                    nameLine +
                '</span>';
        html += '<span style="font-size:0.55rem;color:var(--text-dim);">' +
                    safeStatus +
                '</span>';
        html += '</div>';

        var badges = renderBadges(item);
        if (badges) {
            html += badges;
        }

        html += '</div>';
        return html;
    }

    function renderBadges(item) {
        var badges = [];

        var teams = Array.isArray(item.teamObjects)
            ? item.teamObjects
            : [];
        for (var t = 0; t < teams.length; t++) {
            var team = teams[t];
            if (!team || !team.name) { continue; }
            badges.push(
                '<span style="font-size:0.5rem;color:var(--info);">' +
                    escapeHtml(team.name) +
                '</span>'
            );
        }

        if (item.deceased) {
            badges.push(
                '<span style="font-size:0.5rem;color:var(--danger);">' +
                    'Deceased' +
                '</span>'
            );
        }

        if (item.eliminated) {
            var elimText = 'Eliminated';
            if (item.eliminationYear) {
                elimText += ' ' +
                    escapeHtml(String(item.eliminationYear));
                if (item.eliminationWeek) {
                    elimText += ' Wk' +
                        escapeHtml(String(item.eliminationWeek));
                }
            } else if (item.eliminationWeek) {
                elimText += ' Wk' +
                    escapeHtml(String(item.eliminationWeek));
            }
            badges.push(
                '<span style="font-size:0.5rem;color:var(--warning);">' +
                    elimText +
                '</span>'
            );
        }

        if (badges.length === 0) { return ''; }

        return '<div style="display:flex;flex-wrap:wrap;gap:4px;' +
                    'margin-top:2px;">' +
                    badges.join(' ') +
                '</div>';
    }

    // ============================================================
    // PUBLIC STATE ACCESS
    // ============================================================

    function getFilterValuesPublic() {
        return getFilterValues();
    }

    function getHideFiller() {
        return getHideFillerFromDOM();
    }

    function setHideFiller(value) {
        var boolValue = value !== false;
        setHideFillerInStorage(boolValue);

        var cb = document.getElementById('hide-filler');
        if (cb) { cb.checked = boolValue; }

        render();
    }

    function getSort() {
        return getSortFromDOM();
    }

    function setSort(value) {
        if (!VALID_SORTS[value]) { return; }
        setSortInStorage(value);

        var el = document.getElementById('char-sort');
        if (el) { el.value = value; }

        render();
    }

    // ============================================================
    // REFRESH / DESTROY
    // ============================================================

    function refresh() {
        render();
    }

    function destroy() {
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

        getHideFiller: getHideFiller,
        setHideFiller: setHideFiller,

        getSort: getSort,
        setSort: setSort,

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
            'getFilterValues',
            'getHideFiller',
            'setHideFiller',
            'getSort',
            'setSort'
        ];

        for (var i = 0; i < required.length; i++) {
            if (typeof exports[required[i]] !== 'function') {
                missing.push(required[i]);
            }
        }

        if (missing.length > 0) {
            console.warn(
                '[CharacterList] Verification — some exports may be ' +
                'missing:', missing.join(', ')
            );
        }
    })();

})();
