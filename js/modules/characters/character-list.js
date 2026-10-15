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
 *   - Own the selection set (character IDs ticked via the row
 *     checkbox). Selection is in-memory only; it is not persisted.
 *   - Render a selection bar above the rows when anything is
 *     selected.
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
 * CLEAR FILTER BUTTON:
 *   The Clear filter button (in the sidebar) resets all filters AND
 *   clears the selection. This is the intended "fresh start"
 *   behaviour. A caller that needs to reset filters WITHOUT clearing
 *   the selection should call the individual setters or restore the
 *   filter controls directly.
 *
 * SELECTION:
 *   Each row carries a checkbox at the far left. Clicking the
 *   checkbox toggles that character's presence in the selection
 *   set. Clicking the row body (outside the checkbox) selects the
 *   character for editing.
 *
 *   The selection bar renders above the rows when at least one
 *   character is ticked. It shows "N selected" and a Clear button.
 *
 *   The selection is NOT persisted. It is pruned on every render:
 *   any ID whose character no longer exists is dropped.
 *
 *   The public API is:
 *     getSelectedIds()        -> string[]
 *     setSelectedIds(ids)     -> void
 *     clearSelection()        -> void
 *     hasSelection()          -> boolean
 *     getSelectionCount()     -> number
 *
 * FILTER SNAPSHOT:
 *   getFilterValues() rebuilds its return object on every call.
 *   A caller holding a returned object sees a stable snapshot; a
 *   later filter change does not mutate the held object.
 *
 * LOAD ORDER:
 *   All dependencies are resolved lazily at call time. The module
 *   loads cleanly regardless of script order.
 *
 * DEPENDENCIES (LAZY):
 *   - window.CharacterAggregator
 *   - window.CharacterQueries
 *   - window.DomUtils
 *   - window.AcademyClasses
 *   - window.CalendarConstants
 *   - window.CharacterClassView (optional; local fallback for
 *     populateClassFilter if absent)
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
    function getCharacterClassView() { return window.CharacterClassView || null; }

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
    // STATE
    // ============================================================

    // Selection set: { [characterId]: true }
    // Prototype-safe: Object.create(null).
    var _selectedIds = Object.create(null);

    // ============================================================
    // HELPERS
    // ============================================================

    function hasOwnKey(obj, key) {
        return Object.prototype.hasOwnProperty.call(obj, key);
    }

    function escapeHtml(value) {
        var DU = getDomUtils();
        if (DU && typeof DU.escapeHtml === 'function') {
            return DU.escapeHtml(value);
        }
        if (value === undefined || value === null) {
            return '';
        }
        return String(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function escapeAttribute(value) {
        var DU = getDomUtils();
        if (DU && typeof DU.escapeAttribute === 'function') {
            return DU.escapeAttribute(value);
        }
        if (value === undefined || value === null) {
            return '';
        }
        return String(value)
            .replace(/&/g, '&amp;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    // ============================================================
    // STORAGE
    // ============================================================

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
    // SELECTION
    // ============================================================

    function getSelectedIds() {
        var out = [];
        var keys = Object.keys(_selectedIds);
        for (var i = 0; i < keys.length; i++) {
            if (_selectedIds[keys[i]] === true) {
                out.push(keys[i]);
            }
        }
        return out;
    }

    function setSelectedIds(ids) {
        _selectedIds = Object.create(null);
        if (!Array.isArray(ids)) { return; }
        for (var i = 0; i < ids.length; i++) {
            if (ids[i] === null || ids[i] === undefined) {
                continue;
            }
            var s = String(ids[i]);
            if (s === '') { continue; }
            _selectedIds[s] = true;
        }
    }

    function clearSelection() {
        _selectedIds = Object.create(null);
    }

    function hasSelection() {
        var keys = Object.keys(_selectedIds);
        for (var i = 0; i < keys.length; i++) {
            if (_selectedIds[keys[i]] === true) {
                return true;
            }
        }
        return false;
    }

    function getSelectionCount() {
        var count = 0;
        var keys = Object.keys(_selectedIds);
        for (var i = 0; i < keys.length; i++) {
            if (_selectedIds[keys[i]] === true) {
                count++;
            }
        }
        return count;
    }

    function isSelected(id) {
        if (id === null || id === undefined) { return false; }
        return _selectedIds[String(id)] === true;
    }

    function toggleSelected(id) {
        if (id === null || id === undefined) { return; }
        var s = String(id);
        if (s === '') { return; }
        if (_selectedIds[s]) {
            delete _selectedIds[s];
        } else {
            _selectedIds[s] = true;
        }
    }

    /**
     * Prune the selection set down to IDs that still exist in the
     * store. Called at the top of every render so a deleted
     * character does not linger in the selection.
     */
    function pruneSelection() {
        var CharacterQueries = getCharacterQueries();
        if (!CharacterQueries ||
            typeof CharacterQueries.getCharacterById !== 'function') {
            return;
        }

        var keys = Object.keys(_selectedIds);
        for (var i = 0; i < keys.length; i++) {
            var c = null;
            try {
                c = CharacterQueries.getCharacterById(keys[i]);
            } catch (e) {
                c = null;
            }
            if (!c) {
                delete _selectedIds[keys[i]];
            }
        }
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

    /**
     * Returns a fresh snapshot of the current filter values.
     * Rebuilt on every call; safe for callers to hold.
     */
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

    function populateClassFilter() {
        var ClassView = getCharacterClassView();
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
                        escapeAttribute(cls.id) + '">' +
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

        // Drop any selected IDs whose character no longer exists.
        pruneSelection();

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

        // Selection bar (only when something is selected).
        html += renderSelectionBar();

        // Rows.
        for (var i = 0; i < items.length; i++) {
            html += renderRow(items[i], currentEditId);
        }

        container.innerHTML = html;
    }

    // ============================================================
    // SELECTION BAR
    // ============================================================

    function renderSelectionBar() {
        var count = getSelectionCount();
        if (count === 0) { return ''; }

        var html = '';
        html += '<div class="char-selection-bar">';
        html += '<span class="char-selection-count">' +
                    '<strong>' + count + '</strong> selected' +
                '</span>';
        html += '<button type="button" ' +
                    'class="small secondary char-selection-clear" ' +
                    'data-action="char-clear-selection">' +
                    'Clear' +
                '</button>';
        html += '</div>';
        return html;
    }

    // ============================================================
    // ROW
    // ============================================================

    function renderRow(item, currentEditId) {
        var isCurrent = currentEditId !== null &&
            String(item.id) === String(currentEditId);

        var isTicked = isSelectedForExport(item.id);

        var safeId = escapeAttribute(item.id);
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
        if (isCurrent) { rowClass += ' selected'; }
        if (item.deceased) { rowClass += ' deceased'; }
        if (item.eliminated) { rowClass += ' eliminated'; }
        if (isTicked) { rowClass += ' char-list-item-ticked'; }

        var rowStyle = 'padding:4px 6px;' +
            'border-bottom:1px solid var(--border-soft);' +
            'cursor:pointer;';
        if (isCurrent) {
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

        // ---- Checkbox cell ----
        html += '<span class="char-list-checkbox-cell">';
        html += '<input type="checkbox" ' +
                    'class="char-list-checkbox" ' +
                    'data-character-id="' + safeId + '"' +
                    (isTicked ? ' checked' : '') +
                    ' aria-label="Select ' +
                        escapeAttribute(item.name || 'character') +
                    '">';
        html += '</span>';

        // ---- Content cell ----
        html += '<span class="char-list-content">';

        html += '<span class="char-list-line">';
        html += '<span style="font-size:0.75rem;">' +
                    nameLine +
                '</span>';
        html += '<span style="font-size:0.55rem;color:var(--text-dim);">' +
                    safeStatus +
                '</span>';
        html += '</span>';

        var badges = renderBadges(item);
        if (badges) {
            html += badges;
        }

        html += '</span>';

        html += '</div>';
        return html;
    }

    function isSelectedForExport(id) {
        if (id === null || id === undefined) { return false; }
        var key = String(id);
        return hasOwnKey(_selectedIds, key) &&
            _selectedIds[key] === true;
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

        return '<span style="display:flex;flex-wrap:wrap;gap:4px;' +
                    'margin-top:2px;">' +
                    badges.join(' ') +
                '</span>';
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
        _selectedIds = Object.create(null);
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

        getCurrentEditId: getCurrentEditId,

        // Selection API
        getSelectedIds: getSelectedIds,
        setSelectedIds: setSelectedIds,
        clearSelection: clearSelection,
        hasSelection: hasSelection,
        getSelectionCount: getSelectionCount,
        isSelected: isSelected,
        toggleSelected: toggleSelected
    };

    // ============================================================
    // VERIFICATION
    // ============================================================

    (function verify() {
        var exports = window.CharacterList;
        var failures = [];

        var required = [
            'render',
            'refresh',
            'destroy',
            'populateClassFilter',
            'getFilterValues',
            'getHideFiller',
            'setHideFiller',
            'getSort',
            'setSort',
            'getSelectedIds',
            'setSelectedIds',
            'clearSelection',
            'hasSelection',
            'getSelectionCount'
        ];

        for (var i = 0; i < required.length; i++) {
            if (typeof exports[required[i]] !== 'function') {
                failures.push('missing export: ' + required[i]);
            }
        }

        try {
            if (exports.hasSelection() !== false) {
                failures.push('hasSelection() should be false initially');
            }
            if (exports.getSelectionCount() !== 0) {
                failures.push('getSelectionCount() should be 0 initially');
            }
            if (exports.getSelectedIds().length !== 0) {
                failures.push('getSelectedIds() should be empty initially');
            }
        } catch (e) {
            failures.push('smoke test threw: ' + e.message);
        }

        if (failures.length > 0) {
            throw new Error(
                '[CharacterList] Verification failed: ' +
                failures.join('; ')
            );
        }
    })();

})();
