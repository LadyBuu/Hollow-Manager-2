/**
 * modules/research/research-view.js - Research View
 * Pure HTML rendering for the research modal.
 *
 * Path: js/modules/research/research-view.js
 *
 * WHAT THIS OWNS:
 *   - The modal header (title, close button).
 *   - The search input and its clear button.
 *   - The initial state (no query entered yet).
 *   - The empty state (query entered, no matches).
 *   - The results list, grouped by character.
 *   - The snippet highlighting: the matched span is wrapped in
 *     <mark> using matchStart/matchEnd from ResearchQueries.
 *
 * WHAT THIS DOES NOT OWN:
 *   - The search itself. ResearchQueries owns it.
 *   - Modal lifecycle. ResearchEvents owns it.
 *   - Event binding. ResearchEvents owns it, via delegation on
 *     the modal content container.
 *
 * VM SHAPE (from ResearchQueries.search):
 *   {
 *     query, normalizedQuery,
 *     groups: [
 *       {
 *         characterId, displayName,
 *         matches: [
 *           { fieldPath, fieldLabel, fieldKey,
 *             snippet, matchStart, matchEnd }
 *         ]
 *       }
 *     ],
 *     totalMatches, totalCharacters
 *   }
 *
 * DOM CONTRACT:
 *   The results host has id="research-results".
 *   Each character group is .research-result-group and carries
 *   data-character-id.
 *   Each match row is .research-result-row and inherits the
 *   character's data-character-id from its group; the events
 *   layer reads the closest group's data-character-id on click.
 *
 * ESCAPING:
 *   Every dynamic value passes through escapeHtml. The snippet
 *   is a special case: it is split into three parts (before,
 *   match, after) using matchStart/matchEnd, and each part is
 *   escaped separately, with <mark> between the before and after
 *   parts. The match boundaries come from the query module and
 *   are guaranteed to lie inside the snippet string.
 *
 * DEPENDENCIES:
 *   - window.DomUtils
 */

(function() {
    'use strict';

    if (window.__researchViewLoaded) {
        return;
    }

    // ============================================================
    // DEPENDENCIES
    // ============================================================

    var DomUtils = window.DomUtils;

    if (!DomUtils ||
        typeof DomUtils.escapeHtml !== 'function') {
        throw new Error(
            '[ResearchView] Missing mandatory dependency: ' +
            'DomUtils.escapeHtml'
        );
    }

    window.__researchViewLoaded = true;

    // ============================================================
    // HELPERS
    // ============================================================

    function escapeHtml(value) {
        return DomUtils.escapeHtml(value);
    }

    function escapeAttribute(value) {
        if (typeof DomUtils.escapeAttribute === 'function') {
            return DomUtils.escapeAttribute(value);
        }
        if (value === undefined || value === null) { return ''; }
        return String(value)
            .replace(/&/g, '&amp;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function isNonEmptyString(value) {
        return typeof value === 'string' && value.trim() !== '';
    }

    // ============================================================
    // SNIPPET HIGHLIGHTING
    // ============================================================
    //
    // Split the snippet at matchStart/matchEnd, escape each part
    // separately, and wrap the middle in <mark>. If the offsets
    // are somehow out of range, fall back to escaping the whole
    // snippet without a mark — better to render unhighlighted than
    // to throw.

    function renderSnippet(snippet, matchStart, matchEnd) {
        if (typeof snippet !== 'string') { return ''; }

        if (typeof matchStart !== 'number' ||
            typeof matchEnd !== 'number' ||
            matchStart < 0 ||
            matchEnd > snippet.length ||
            matchStart >= matchEnd) {
            return escapeHtml(snippet);
        }

        var before = snippet.substring(0, matchStart);
        var matched = snippet.substring(matchStart, matchEnd);
        var after = snippet.substring(matchEnd);

        return escapeHtml(before) +
            '<mark class="research-match">' +
                escapeHtml(matched) +
            '</mark>' +
            escapeHtml(after);
    }

    // ============================================================
    // MODAL SHELL
    // ============================================================

    /**
     * Render the modal's initial HTML. The caller (ResearchEvents)
     * assigns this to a .modal-content element's innerHTML, or
     * appends the returned string to a container.
     */
    function renderShell() {
        var html = '';

        html += '<div class="modal-header">';
        html += '<h3 id="research-modal-title">' +
                    'Search Character Profiles' +
                '</h3>';
        html += '<button type="button" class="close-modal" ' +
                    'data-action="research-close" ' +
                    'aria-label="Close">&times;</button>';
        html += '</div>';

        html += '<div class="modal-body research-body">';

        html += '<div class="research-search-row">';
        html += '<input type="text" ' +
                    'id="research-input" ' +
                    'class="research-input" ' +
                    'placeholder="Search names, titles, personality, ' +
                        'physical..." ' +
                    'autocomplete="off" ' +
                    'autocapitalize="off" ' +
                    'spellcheck="false">';
        html += '<button type="button" ' +
                    'id="research-clear-btn" ' +
                    'class="small secondary research-clear-btn" ' +
                    'data-action="research-clear" ' +
                    'aria-label="Clear search">' +
                    'Clear' +
                '</button>';
        html += '</div>';

        html += '<div id="research-results" ' +
                    'class="research-results">' +
                    renderInitialState() +
                '</div>';

        html += '</div>';

        return html;
    }

    // ============================================================
    // STATES
    // ============================================================

    function renderInitialState() {
        return '<p class="empty-state research-empty">' +
                    'Type a word to search across names, titles, ' +
                    'personality, and physical descriptions.' +
                '</p>';
    }

    function renderEmptyResults(vm) {
        var query = vm && vm.query ? vm.query : '';
        return '<p class="empty-state research-empty">' +
                    'No matches for "' +
                    escapeHtml(query) +
                    '".' +
                '</p>';
    }

    // ============================================================
    // RESULTS
    // ============================================================

    /**
     * Render the results list. This is what ResearchEvents writes
     * into #research-results after each debounced search.
     */
    function renderResults(vm) {
        if (!vm) {
            return renderInitialState();
        }

        if (vm.normalizedQuery === '') {
            return renderInitialState();
        }

        if (!Array.isArray(vm.groups) || vm.groups.length === 0) {
            return renderEmptyResults(vm);
        }

        var html = '';

        html += '<div class="research-summary">' +
                    escapeHtml(String(vm.totalMatches)) +
                    ' match' +
                    (vm.totalMatches === 1 ? '' : 'es') +
                    ' across ' +
                    escapeHtml(String(vm.totalCharacters)) +
                    ' character' +
                    (vm.totalCharacters === 1 ? '' : 's') +
                '</div>';

        html += '<div class="research-groups">';
        for (var i = 0; i < vm.groups.length; i++) {
            html += renderGroup(vm.groups[i]);
        }
        html += '</div>';

        return html;
    }

    function renderGroup(group) {
        if (!group || !group.characterId) { return ''; }

        var matches = Array.isArray(group.matches)
            ? group.matches
            : [];

        var html = '';

        html += '<div class="research-result-group" ' +
                    'data-character-id="' +
                        escapeAttribute(group.characterId) + '">';

        html += '<div class="research-result-group-header">';
        html += '<span class="research-result-name">' +
                    escapeHtml(group.displayName || 'Unknown') +
                '</span>';
        html += '<span class="research-result-count">' +
                    escapeHtml(String(matches.length)) +
                    ' match' +
                    (matches.length === 1 ? '' : 'es') +
                '</span>';
        html += '</div>';

        for (var i = 0; i < matches.length; i++) {
            html += renderMatchRow(matches[i]);
        }

        html += '</div>';

        return html;
    }

    function renderMatchRow(match) {
        if (!match) { return ''; }

        var label = isNonEmptyString(match.fieldLabel)
            ? match.fieldLabel
            : match.fieldPath || 'Field';

        var html = '';

        html += '<div class="research-result-row">';

        html += '<span class="research-result-field">' +
                    escapeHtml(label) +
                '</span>';

        html += '<span class="research-result-snippet">' +
                    renderSnippet(
                        match.snippet,
                        match.matchStart,
                        match.matchEnd
                    ) +
                '</span>';

        html += '</div>';

        return html;
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.ResearchView = Object.freeze({
        renderShell: renderShell,
        renderResults: renderResults,
        renderInitialState: renderInitialState
    });

    // ============================================================
    // VERIFICATION
    // ============================================================

    (function verify() {
        var exports = window.ResearchView;
        var missing = [];

        var required = [
            'renderShell',
            'renderResults',
            'renderInitialState'
        ];

        for (var i = 0; i < required.length; i++) {
            if (typeof exports[required[i]] !== 'function') {
                missing.push(required[i]);
            }
        }

        try {
            // Shell contains the expected anchors.
            var shell = renderShell();
            if (shell.indexOf('id="research-input"') === -1) {
                missing.push('shell missing #research-input');
            }
            if (shell.indexOf('id="research-results"') === -1) {
                missing.push('shell missing #research-results');
            }
            if (shell.indexOf('data-action="research-close"') === -1) {
                missing.push('shell missing research-close button');
            }

            // Empty VM renders the initial state.
            var initial = renderResults({
                query: '',
                normalizedQuery: '',
                groups: [],
                totalMatches: 0,
                totalCharacters: 0
            });
            if (initial.indexOf('Type a word') === -1) {
                missing.push('empty VM did not render initial state');
            }

            // Non-empty VM with no groups renders the no-match state.
            var noMatch = renderResults({
                query: 'zzz',
                normalizedQuery: 'zzz',
                groups: [],
                totalMatches: 0,
                totalCharacters: 0
            });
            if (noMatch.indexOf('No matches') === -1) {
                missing.push('no-match VM did not render empty state');
            }

            // A group with one match renders the row and the mark.
            var withMatch = renderResults({
                query: 'beast',
                normalizedQuery: 'beast',
                groups: [{
                    characterId: 'char_x',
                    displayName: 'Beast Handler',
                    matches: [{
                        fieldPath: 'personality.likes',
                        fieldLabel: 'Likes',
                        fieldKey: null,
                        snippet: 'likes beasts a lot',
                        matchStart: 6,
                        matchEnd: 12
                    }]
                }],
                totalMatches: 1,
                totalCharacters: 1
            });
            if (withMatch.indexOf('data-character-id="char_x"') === -1) {
                missing.push('group missing data-character-id');
            }
            if (withMatch.indexOf('<mark') === -1) {
                missing.push('match span not highlighted');
            }
            if (withMatch.indexOf('>beasts<') === -1) {
                missing.push('marked text missing');
            }

            // Escaping: a character name with HTML is neutralised.
            var escaped = renderResults({
                query: 'x',
                normalizedQuery: 'x',
                groups: [{
                    characterId: 'char_y',
                    displayName: '<script>x</script>',
                    matches: [{
                        fieldPath: 'title',
                        fieldLabel: 'Title',
                        fieldKey: null,
                        snippet: 'x',
                        matchStart: 0,
                        matchEnd: 1
                    }]
                }],
                totalMatches: 1,
                totalCharacters: 1
            });
            if (escaped.indexOf('<script>') !== -1) {
                missing.push('displayName was not escaped');
            }
        } catch (e) {
            missing.push('smoke test threw: ' + e.message);
        }

        if (missing.length > 0) {
            console.warn(
                '[ResearchView] Verification failed:',
                missing.join(', ')
            );
        }
    })();

})();
