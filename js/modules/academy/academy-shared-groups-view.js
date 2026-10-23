/**
 * modules/academy/academy-shared-groups-view.js
 * Academy Shared Groups View
 *
 * Path: js/modules/academy/academy-shared-groups-view.js
 *
 * Standalone view for the "find shared groups" feature. Answers:
 * "for these two or more characters, which teaching groups do they
 * have in common, and during which weeks?"
 *
 * RENDER ONLY:
 *   No mutations. No domain reads. No state. Receives a view model
 *   from AcademySharedGroupsController and returns an HTML string.
 *   Emits data-* attributes for the controller (via AcademyView's
 *   delegated listeners).
 *
 * VM SHAPE (built by the controller):
 *   {
 *     classes:       [ { id, name } ],     // class filter options
 *     selectedClassId: string|null,        // '' means "all classes"
 *
 *     characters:    [ { id, name } ],     // every character in
 *                                          // the picker, sorted
 *
 *     selectedCharIds: [ 'char_a', ... ],  // the current selection
 *     anchorCharId:  string|null,          // optional, set when
 *                                          // launched from a
 *                                          // character's schedule
 *
 *     filter:        string,               // picker search term
 *
 *     result:        {                     // from aggregator; see
 *                                          // getSharedGroupsViewModel
 *       charIds, characters, rows, totalRows
 *     }
 *   }
 *
 * EVENTS EMITTED:
 *   - .academy-shared-groups-class-select     (change)
 *   - #academy-shared-groups-search           (input)
 *   - .academy-shared-groups-char-checkbox    (change)
 *   - [data-action="shared-groups-clear-selection"]     (click)
 *   - [data-action="shared-groups-remove-character"]    (click)
 *     with data-character-id
 *
 * LAYOUT:
 *   Top bar spans the width. Below it, a two-column layout:
 *     LEFT:   picker panel (search + checkbox list of characters,
 *             filtered by the search term; selected characters
 *             float to the top of the list, and also appear in a
 *             compact "chips" strip above the search box).
 *     RIGHT:  result panel.
 *
 *   The picker's "selected chips" strip exists so that a user who
 *   has scrolled or searched away from a selected character still
 *   sees who is currently in the set. Removing a chip is a single
 *   click; it is the fastest way to change the selection without
 *   scrolling.
 *
 *   The picker's checkbox rows live in a scrollable body. The
 *   selected characters are rendered in the same order they
 *   appear in `characters[]`, so the list does not reshuffle as
 *   the user checks boxes.
 *
 * RESULTS:
 *   Empty selection (fewer than 2 characters): "Select at least
 *   two characters to see which groups they share."
 *
 *   Two or more selected, no matches: "No shared groups. These
 *   characters are not enrolled in the same group for any
 *   discipline during the selected period."
 *
 *   Matches: a list of rows grouped by class then discipline is
 *   NOT imposed here; the aggregator returns them sorted by
 *   (class, discipline, group) and the view renders in that
 *   order, with a small header inserted whenever the class or
 *   discipline changes. That keeps the renderer stateless while
 *   still producing visual grouping.
 *
 *   Each row shows:
 *     Group name (e.g. "English A" or a custom name)
 *     Instructor name (or "Unassigned")
 *     Roster size at the most recent shared week
 *     "Together: Alice, Bob" (the subset in this group)
 *     "Weeks: 3–7, 12" (contiguous ranges)
 *
 * DEPENDENCIES:
 *   - window.DomUtils (MANDATORY)
 *
 * USAGE:
 *   var html = AcademySharedGroupsView.renderHTML(vm);
 *   host.innerHTML = html;
 */

(function() {
    'use strict';

    if (window.__academySharedGroupsViewLoaded) {
        return;
    }

    var DomUtils = window.DomUtils;

    if (!DomUtils ||
        typeof DomUtils.escapeHtml !== 'function' ||
        typeof DomUtils.escapeAttribute !== 'function') {
        throw new Error(
            '[AcademySharedGroupsView] Missing mandatory dependency: ' +
            'DomUtils.escapeHtml / DomUtils.escapeAttribute'
        );
    }

    window.__academySharedGroupsViewLoaded = true;

    // ============================================================
    // ESCAPING
    // ============================================================

    function escapeHtml(value) {
        return DomUtils.escapeHtml(value);
    }

    function escapeAttribute(value) {
        return DomUtils.escapeAttribute(value);
    }

    // ============================================================
    // SMALL HELPERS
    // ============================================================

    function isNonEmptyString(value) {
        return typeof value === 'string' && value.trim() !== '';
    }

    function isFiniteNumber(value) {
        return typeof value === 'number' && isFinite(value);
    }

    function renderWeekRanges(ranges) {
        if (!Array.isArray(ranges) || ranges.length === 0) {
            return '—';
        }
        var parts = [];
        for (var i = 0; i < ranges.length; i++) {
            var r = ranges[i];
            if (!r || !isFiniteNumber(r.start) || !isFiniteNumber(r.end)) {
                continue;
            }
            if (r.start === r.end) {
                parts.push(String(r.start));
            } else {
                parts.push(r.start + '\u2013' + r.end);
            }
        }
        if (parts.length === 0) { return '—'; }
        return parts.join(', ');
    }

    // ============================================================
    // VM VALIDATION
    // ============================================================
    //
    // Strict. The controller is responsible for producing a
    // well-formed VM. A missing field is a controller bug, not a
    // request for a default.

    function validateVM(viewModel) {
        if (!viewModel || typeof viewModel !== 'object') {
            throw new Error(
                '[AcademySharedGroupsView] renderHTML requires a ' +
                'view model object.'
            );
        }

        var vm = viewModel;

        if (!Array.isArray(vm.classes)) {
            throw new Error(
                '[AcademySharedGroupsView] VM.classes must be an array.'
            );
        }
        if (!Array.isArray(vm.characters)) {
            throw new Error(
                '[AcademySharedGroupsView] VM.characters must be an array.'
            );
        }
        if (!Array.isArray(vm.selectedCharIds)) {
            throw new Error(
                '[AcademySharedGroupsView] VM.selectedCharIds must be ' +
                'an array.'
            );
        }
        if (typeof vm.filter !== 'string') {
            throw new Error(
                '[AcademySharedGroupsView] VM.filter must be a string.'
            );
        }
        if (!vm.result || typeof vm.result !== 'object') {
            throw new Error(
                '[AcademySharedGroupsView] VM.result must be an object ' +
                'from getSharedGroupsViewModel.'
            );
        }
        if (!Array.isArray(vm.result.rows)) {
            throw new Error(
                '[AcademySharedGroupsView] VM.result.rows must be an ' +
                'array.'
            );
        }
        if (!isFiniteNumber(vm.result.totalRows)) {
            throw new Error(
                '[AcademySharedGroupsView] VM.result.totalRows must be ' +
                'a finite number.'
            );
        }

        return vm;
    }

    // ============================================================
    // PUBLIC ENTRY POINT
    // ============================================================

    function renderHTML(viewModel) {
        var vm = validateVM(viewModel);

        var html = '';
        html += '<div class="academy-body academy-shared-groups-root">';

        html += renderTopBar(vm);
        html += '<div class="academy-shared-groups-panels">';
        html += renderPickerPanel(vm);
        html += renderResultPanel(vm);
        html += '</div>';

        html += '</div>';

        return html;
    }

    // ============================================================
    // TOP BAR
    // ============================================================

    function renderTopBar(vm) {
        var classes = vm.classes;
        var selectedClassId = vm.selectedClassId || '';

        var html = '';
        html += '<div class="academy-shared-groups-top-bar">';

        html += '<div class="academy-shared-groups-top-left">';
        html += '<label class="academy-top-label" ' +
                    'for="academy-shared-groups-class-select">' +
                    'Class:' +
                '</label>';
        html += '<select id="academy-shared-groups-class-select" ' +
                    'class="academy-class-select ' +
                        'academy-shared-groups-class-select">';
        html += '<option value=""' +
                    (selectedClassId === '' ? ' selected' : '') +
                    '>All classes</option>';
        for (var i = 0; i < classes.length; i++) {
            var cls = classes[i];
            if (!cls || !cls.id) { continue; }
            var selected = String(cls.id) === String(selectedClassId)
                ? ' selected'
                : '';
            html += '<option value="' + escapeAttribute(cls.id) + '"' +
                        selected + '>' +
                        escapeHtml(cls.name) +
                    '</option>';
        }
        html += '</select>';
        html += '</div>';

        html += '<div class="academy-shared-groups-top-right">';
        html += '<span class="academy-shared-groups-summary">' +
                    vm.selectedCharIds.length + ' character' +
                    (vm.selectedCharIds.length === 1 ? '' : 's') +
                    ' selected' +
                '</span>';
        html += '</div>';

        html += '</div>';
        return html;
    }

    // ============================================================
    // PICKER PANEL (left)
    // ============================================================

    function renderPickerPanel(vm) {
        var characters = vm.characters;
        var selectedSet = Object.create(null);
        for (var i = 0; i < vm.selectedCharIds.length; i++) {
            selectedSet[String(vm.selectedCharIds[i])] = true;
        }

        var html = '';
        html += '<div class="academy-shared-groups-sidebar">';

        // ---- Selected chips ----
        html += renderSelectedChips(vm, selectedSet);

        // ---- Search ----
        html += '<input type="text" id="academy-shared-groups-search" ' +
                    'class="academy-shared-groups-search" ' +
                    'placeholder="Search characters..." ' +
                    'autocomplete="off" spellcheck="false" ' +
                    'value="' + escapeAttribute(vm.filter) + '">';

        // ---- Character list ----
        html += '<div class="academy-shared-groups-char-list">';

        if (characters.length === 0) {
            html += '<p class="empty-state small">' +
                        'No characters available.' +
                    '</p>';
            html += '</div>';
            html += '</div>';
            return html;
        }

        var filterLower = vm.filter.toLowerCase().trim();
        var rendered = 0;

        for (var j = 0; j < characters.length; j++) {
            var c = characters[j];
            if (!c || !c.id) { continue; }

            var cId = String(c.id);
            var isSelected = selectedSet[cId] === true;

            // A selected character is visible even when the search
            // filter does not match its name: the user is actively
            // working with it, and hiding it under a filter would
            // make the selection look "lost".
            if (filterLower !== '' &&
                c.name.toLowerCase().indexOf(filterLower) === -1 &&
                !isSelected) {
                continue;
            }

            rendered++;
            html += renderCharacterRow(c, isSelected);
        }

        if (rendered === 0) {
            html += '<p class="empty-state small">' +
                        'No characters match the search.' +
                    '</p>';
        }

        html += '</div>';
        html += '</div>';
        return html;
    }

    function renderSelectedChips(vm, selectedSet) {
        var characters = vm.characters;
        var chips = [];

        // Preserve the order the selected characters appear in the
        // full character list, so the chips do not reshuffle when
        // the user toggles a checkbox.
        for (var i = 0; i < characters.length; i++) {
            var c = characters[i];
            if (!c || !c.id) { continue; }
            if (selectedSet[String(c.id)] !== true) { continue; }
            chips.push(c);
        }

        if (chips.length === 0) {
            return '';
        }

        var html = '';
        html += '<div class="academy-shared-groups-chips">';

        for (var j = 0; j < chips.length; j++) {
            var chip = chips[j];
            html += '<span class="academy-shared-groups-chip" ' +
                        'data-character-id="' +
                            escapeAttribute(chip.id) + '">';
            html += '<span class="academy-shared-groups-chip-name">' +
                        escapeHtml(chip.name) +
                    '</span>';
            html += '<button type="button" ' +
                        'class="academy-shared-groups-chip-remove" ' +
                        'data-action="shared-groups-remove-character" ' +
                        'data-character-id="' +
                            escapeAttribute(chip.id) + '" ' +
                        'title="Remove ' +
                            escapeAttribute(chip.name) + ' from the ' +
                            'selection" ' +
                        'aria-label="Remove ' +
                            escapeAttribute(chip.name) + '">' +
                        '\u2715' +
                    '</button>';
            html += '</span>';
        }

        html += '</div>';

        html += '<div class="academy-shared-groups-chip-actions">';
        html += '<button type="button" class="small secondary" ' +
                    'data-action="shared-groups-clear-selection">' +
                    'Clear selection' +
                '</button>';
        html += '</div>';

        return html;
    }

    function renderCharacterRow(character, isSelected) {
        var checked = isSelected ? ' checked' : '';
        var rowClass = 'academy-shared-groups-char-row';
        if (isSelected) {
            rowClass += ' is-selected';
        }

        var html = '';
        html += '<label class="' + rowClass + '">';
        html += '<input type="checkbox" ' +
                    'class="academy-shared-groups-char-checkbox" ' +
                    'data-character-id="' +
                        escapeAttribute(character.id) + '"' +
                    checked + '>';
        html += '<span class="academy-shared-groups-char-name">' +
                    escapeHtml(character.name) +
                '</span>';
        html += '</label>';
        return html;
    }

    // ============================================================
    // RESULT PANEL (right)
    // ============================================================

    function renderResultPanel(vm) {
        var selectedCount = vm.selectedCharIds.length;
        var result = vm.result;

        var html = '';
        html += '<div class="academy-shared-groups-results" ' +
                    'id="academy-shared-groups-results">';

        if (selectedCount < 2) {
            html += renderEmptySelection();
            html += '</div>';
            return html;
        }

        if (result.totalRows === 0) {
            html += renderNoMatches(vm);
            html += '</div>';
            return html;
        }

        html += renderResultsHeader(result);
        html += renderResultRows(result.rows);
        html += '</div>';

        return html;
    }

    function renderEmptySelection() {
        return (
            '<div class="academy-shared-groups-empty">' +
                '<p class="empty-state small">' +
                    'Select at least two characters to see which ' +
                    'groups they share.' +
                '</p>' +
            '</div>'
        );
    }

    function renderNoMatches(vm) {
        var names = resolveSelectedNames(vm);
        var nameList = names.length > 0
            ? names.join(' and ')
            : 'these characters';

        return (
            '<div class="academy-shared-groups-empty">' +
                '<p class="empty-state small">' +
                    'No shared groups. ' +
                    escapeHtml(nameList) +
                    ' are not enrolled in the same group for any ' +
                    'discipline during the selected period.' +
                '</p>' +
            '</div>'
        );
    }

    function resolveSelectedNames(vm) {
        var byId = Object.create(null);
        for (var i = 0; i < vm.characters.length; i++) {
            var c = vm.characters[i];
            if (c && c.id) {
                byId[String(c.id)] = c.name;
            }
        }
        var names = [];
        for (var j = 0; j < vm.selectedCharIds.length; j++) {
            var id = String(vm.selectedCharIds[j]);
            if (byId[id]) {
                names.push(byId[id]);
            }
        }
        return names;
    }

    function renderResultsHeader(result) {
        var count = result.totalRows;
        var html = '';
        html += '<div class="academy-shared-groups-results-header">';
        html += '<h3 class="academy-shared-groups-results-title">' +
                    'Shared groups' +
                '</h3>';
        html += '<span class="academy-shared-groups-results-count">' +
                    count + ' match' + (count === 1 ? '' : 'es') +
                '</span>';
        html += '</div>';
        return html;
    }

    function renderResultRows(rows) {
        var html = '';
        html += '<div class="academy-shared-groups-rows">';

        var lastClassId = null;
        var lastDisciplineId = null;

        for (var i = 0; i < rows.length; i++) {
            var row = rows[i];
            if (!row || !row.groupId) { continue; }

            if (String(row.classId) !== String(lastClassId)) {
                html += renderClassHeading(row);
                lastClassId = row.classId;
                lastDisciplineId = null;
            }
            if (String(row.disciplineId) !== String(lastDisciplineId)) {
                html += renderDisciplineHeading(row);
                lastDisciplineId = row.disciplineId;
            }

            html += renderResultRow(row);
        }

        html += '</div>';
        return html;
    }

    function renderClassHeading(row) {
        return (
            '<div class="academy-shared-groups-class-heading">' +
                '<span class="academy-shared-groups-class-name">' +
                    escapeHtml(row.className || 'Unnamed Class') +
                '</span>' +
            '</div>'
        );
    }

    function renderDisciplineHeading(row) {
        return (
            '<div class="academy-shared-groups-discipline-heading">' +
                '<span class="academy-shared-groups-discipline-name">' +
                    escapeHtml(row.disciplineName || 'Unnamed Discipline') +
                '</span>' +
            '</div>'
        );
    }

    function renderResultRow(row) {
        var instructor = isNonEmptyString(row.instructorName)
            ? row.instructorName
            : 'Unassigned';

        var memberCount = isFiniteNumber(row.memberCount)
            ? row.memberCount
            : 0;

        var weekLabel = renderWeekRanges(row.weekRanges);

        var sharedNames = Array.isArray(row.sharedCharNames)
            ? row.sharedCharNames.filter(isNonEmptyString)
            : [];

        var html = '';
        html += '<div class="academy-shared-groups-row" ' +
                    'data-group-id="' +
                        escapeAttribute(row.groupId) + '">';

        // ---- Top line: group name + member count ----
        html += '<div class="academy-shared-groups-row-main">';
        html += '<span class="academy-shared-groups-group-name">' +
                    escapeHtml(row.groupName || 'Unnamed Group') +
                '</span>';
        html += '<span class="academy-shared-groups-instructor">' +
                    escapeHtml(instructor) +
                '</span>';
        html += '<span class="academy-shared-groups-member-count">' +
                    memberCount + ' member' +
                    (memberCount === 1 ? '' : 's') +
                '</span>';
        html += '</div>';

        // ---- Together line ----
        if (sharedNames.length > 0) {
            html += '<div class="academy-shared-groups-row-together">';
            html += '<span class="academy-shared-groups-row-together-label">' +
                        'Together:' +
                    '</span> ';
            html += '<span class="academy-shared-groups-row-together-names">' +
                        escapeHtml(sharedNames.join(', ')) +
                    '</span>';
            html += '</div>';
        }

        // ---- Weeks line ----
        html += '<div class="academy-shared-groups-row-weeks">';
        html += '<span class="academy-shared-groups-row-weeks-label">' +
                    'Weeks:' +
                '</span> ';
        html += '<span class="academy-shared-groups-row-weeks-value">' +
                    escapeHtml(weekLabel) +
                '</span>';
        html += '</div>';

        html += '</div>';
        return html;
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.AcademySharedGroupsView = Object.freeze({
        renderHTML: renderHTML
    });

    // ============================================================
    // VERIFICATION
    // ============================================================

    (function verify() {
        var exports = window.AcademySharedGroupsView;
        var missing = [];

        if (typeof exports.renderHTML !== 'function') {
            missing.push('renderHTML');
        }

        try {
            if (renderWeekRanges([{ start: 1, end: 1 }]) !== '1') {
                missing.push('renderWeekRanges single-week failed');
            }
            if (renderWeekRanges([{ start: 1, end: 5 }, { start: 8, end: 8 }]) !==
                '1\u20135, 8') {
                missing.push('renderWeekRanges multi-range failed');
            }
        } catch (e) {
            missing.push('smoke test threw: ' + e.message);
        }

        if (missing.length > 0) {
            console.warn(
                '[AcademySharedGroupsView] Verification - some exports ' +
                'may be missing:', missing.join(', ')
            );
        }
    })();

})();
