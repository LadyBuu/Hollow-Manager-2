/**
 * modules/research/research-queries.js - Research Queries
 * Pure text search over the character store.
 *
 * Path: js/modules/research/research-queries.js
 *
 * WHAT THIS OWNS:
 *   - The curated field list (RESEARCH_FIELDS).
 *   - Accent-insensitive, case-insensitive substring search.
 *   - Grouping matches by character.
 *   - Snippet extraction with the match positioned in context.
 *
 * WHAT THIS DOES NOT OWN:
 *   - Rendering. ResearchView owns it.
 *   - Modal lifecycle. ResearchEvents owns it.
 *   - Any mutation. This module never writes.
 *
 * SEARCHED FIELDS:
 *   The curated set, defined in RESEARCH_FIELDS below. Currently:
 *
 *     name            displayName (from CharacterQueries)
 *     fullName        fullName (from CharacterQueries)
 *     title           char.title
 *     personality.*   every string leaf under personality
 *     physical.*      eyes, hair, skin, height, weight, build,
 *                     appearanceNotes
 *     careerStatus.*  status, title (per entry)
 *
 *   Explicitly NOT searched: stats, magic, weapons, specialMoves,
 *   notes, teams, missions, tournaments, classes, disciplines.
 *   Those are either too noisy or owned by other tabs.
 *
 *   To add a field: append an entry to RESEARCH_FIELDS. To drop a
 *   field: remove its entry. The walker does not change.
 *
 * FIELD PATH SYNTAX:
 *   - 'title'                    top-level string
 *   - 'personality.likes'        nested string
 *   - 'careerStatus[].status'    array of strings, one per entry
 *   - 'careerStatus[].title'     array of strings, one per entry
 *
 *   Array syntax '[].' means: the field is an array, iterate its
 *   entries, and pull the named sub-key from each. The walker
 *   returns one candidate string per array element, so a match in
 *   the second careerStatus entry is reported separately from a
 *   match in the first.
 *
 * ACCENT NORMALISATION:
 *   Both haystack and needle are passed through
 *   String.normalize('NFD') and stripped of combining marks before
 *   comparison. 'Côben' matches 'coben'; 'Beást' matches 'beast'.
 *   The snippet still shows the original (accented) text.
 *
 * SNIPPET:
 *   ±40 characters around the match, with ellipses when truncated.
 *   The un-normalised text is used, so the snippet preserves
 *   accents and casing.
 *
 * NO MATCH FORMATTING:
 *   The query returns { fieldPath, fieldLabel, snippet,
 *   matchStart, matchEnd } per match. matchStart and matchEnd are
 *   positions in the SNIPPET string, not the original. ResearchView
 *   uses them to wrap the matched span in <mark>.
 *
 * DEPENDENCIES (MANDATORY):
 *   - window.CharacterQueries
 *
 * DEPENDENCIES (LAZY):
 *   None. window.data is read directly and is guaranteed to exist
 *   by the time the modal can be opened.
 */

(function() {
    'use strict';

    if (window.__researchQueriesLoaded) {
        return;
    }

    // ============================================================
    // DEPENDENCIES
    // ============================================================

    var CharacterQueries = window.CharacterQueries;

    if (!CharacterQueries ||
        typeof CharacterQueries.getCharacters !== 'function') {
        throw new Error(
            '[ResearchQueries] Missing mandatory dependency: ' +
            'CharacterQueries.getCharacters'
        );
    }

    window.__researchQueriesLoaded = true;

    // ============================================================
    // CURATED FIELD LIST
    // ============================================================
    //
    // Each entry:
    //   path    dotted key with optional '[]' array marker
    //   label   human-readable label for the results row
    //
    // Add or remove entries here. The walker does not change.

    var RESEARCH_FIELDS = [
        // ---- Identity ----
        { path: 'name',       label: 'Name' },
        { path: 'fullName',   label: 'Full Name' },
        { path: 'title',      label: 'Title' },

        // ---- Personality ----
        { path: 'personality.traits',        label: 'Traits' },
        { path: 'personality.ideals',        label: 'Ideals' },
        { path: 'personality.bonds',         label: 'Bonds' },
        { path: 'personality.flaws',         label: 'Flaws' },
        { path: 'personality.alignment',     label: 'Alignment' },
        { path: 'personality.likes',         label: 'Likes' },
        { path: 'personality.dislikes',      label: 'Dislikes' },
        { path: 'personality.habits',        label: 'Habits' },
        { path: 'personality.fears',         label: 'Fears' },
        { path: 'personality.goals',         label: 'Goals' },
        { path: 'personality.authority',     label: 'Authority' },
        { path: 'personality.conflictStyle', label: 'Conflict Style' },
        { path: 'personality.socialStyle',   label: 'Social Style' },
        { path: 'personality.quirks',        label: 'Quirks' },

        // ---- Physical ----
        { path: 'physical.eyes',            label: 'Eyes' },
        { path: 'physical.hair',            label: 'Hair' },
        { path: 'physical.skin',            label: 'Skin' },
        { path: 'physical.height',          label: 'Height' },
        { path: 'physical.weight',          label: 'Weight' },
        { path: 'physical.build',           label: 'Build' },
        { path: 'physical.appearanceNotes', label: 'Appearance Notes' },

        // ---- Career status labels ----
        { path: 'careerStatus[].status', label: 'Career Status' },
        { path: 'careerStatus[].title',  label: 'Career Title' }
    ];

    // ============================================================
    // CONSTANTS
    // ============================================================

    var SNIPPET_RADIUS = 40;
    var ELLIPSIS = '\u2026';

    // ============================================================
    // NORMALISATION
    // ============================================================

    /**
     * Lowercase, strip diacritics. Safe for any string.
     */
    function normalise(value) {
        if (value === undefined || value === null) { return ''; }
        var s = String(value);
        try {
            s = s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        } catch (e) {
            // Very old browsers lack String.normalize. Fall through
            // with the raw string.
        }
        return s.toLowerCase();
    }

    // ============================================================
    // FIELD RESOLUTION
    // ============================================================
    //
    // resolveField(record, path) -> array of { raw, key } where
    //   raw is the string value at that path (may be '')
    //   key is an optional discriminator for array entries
    //
    // For top-level and nested paths, at most one entry is
    // returned. For array paths ('foo[].bar'), one entry per array
    // element is returned, keyed by that element's index.

    function resolveField(record, path) {
        if (!record || typeof record !== 'object') { return []; }

        var arrayIdx = path.indexOf('[]');
        if (arrayIdx === -1) {
            return resolveScalar(record, path);
        }

        return resolveArray(record, path, arrayIdx);
    }

    function resolveScalar(record, path) {
        var parts = path.split('.');
        var current = record;

        for (var i = 0; i < parts.length; i++) {
            if (current === null || current === undefined) {
                return [];
            }
            if (typeof current !== 'object') {
                return [];
            }
            current = current[parts[i]];
        }

        if (current === undefined || current === null) {
            return [];
        }

        var raw = String(current);
        if (raw.trim() === '') { return []; }

        return [{ raw: raw, key: null }];
    }

    function resolveArray(record, path, arrayIdx) {
        // path = 'careerStatus[].status'
        // head = 'careerStatus', tail = 'status'
        var head = path.substring(0, arrayIdx);
        var tail = path.substring(arrayIdx + 2);
        if (tail.charAt(0) === '.') { tail = tail.substring(1); }

        var arr = descend(record, head);
        if (!Array.isArray(arr) || arr.length === 0) { return []; }

        var results = [];
        for (var i = 0; i < arr.length; i++) {
            var element = arr[i];
            if (!element || typeof element !== 'object') { continue; }

            var leaf = tail === '' ? element : descend(element, tail);
            if (leaf === undefined || leaf === null) { continue; }

            var raw = String(leaf);
            if (raw.trim() === '') { continue; }

            results.push({ raw: raw, key: i });
        }
        return results;
    }

    function descend(record, dottedPath) {
        if (dottedPath === '') { return record; }
        var parts = dottedPath.split('.');
        var current = record;

        for (var i = 0; i < parts.length; i++) {
            if (current === null || current === undefined) {
                return undefined;
            }
            if (typeof current !== 'object') {
                return undefined;
            }
            current = current[parts[i]];
        }
        return current;
    }

    // ============================================================
    // SNIPPET
    // ============================================================
    //
    // Find the first occurrence of the normalised needle inside
    // the normalised haystack, then slice the ORIGINAL haystack
    // around that position. Returns:
    //
    //   { snippet, matchStart, matchEnd }
    //
    // matchStart/matchEnd are indices into the snippet string.
    // Returns null when there is no match.

    function buildSnippet(rawText, normalisedNeedle) {
        if (rawText === undefined || rawText === null) { return null; }
        var haystack = String(rawText);
        if (haystack === '') { return null; }

        var normalisedHaystack = normalise(haystack);
        var matchAt = normalisedHaystack.indexOf(normalisedNeedle);
        if (matchAt === -1) { return null; }

        var matchLen = normalisedNeedle.length;

        // Slice around the match in the original text. Because
        // normalise() preserves length for characters without
        // combining marks, and only strips marks otherwise, the
        // matchAt index is correct for the common case. For strings
        // with decomposed accents (rare), the index may drift by a
        // few characters; the snippet will still contain the match,
        // just slightly off-center.
        var start = matchAt - SNIPPET_RADIUS;
        var end = matchAt + matchLen + SNIPPET_RADIUS;

        var prefix = '';
        if (start > 0) {
            prefix = ELLIPSIS;
        } else {
            start = 0;
        }

        var suffix = '';
        if (end < haystack.length) {
            suffix = ELLIPSIS;
        } else {
            end = haystack.length;
        }

        var snippetBody = haystack.substring(start, end);
        var snippet = prefix + snippetBody + suffix;

        var matchStart = prefix.length + (matchAt - start);
        var matchEnd = matchStart + matchLen;

        return {
            snippet: snippet,
            matchStart: matchStart,
            matchEnd: matchEnd
        };
    }

    // ============================================================
    // DISPLAY NAME
    // ============================================================

    function getDisplayName(char) {
        try {
            var name = CharacterQueries.getDisplayName(char);
            if (name && name.trim() !== '') { return name; }
        } catch (e) {
            // Fall through.
        }
        return 'Unknown';
    }

    function getFullName(char) {
        try {
            if (typeof CharacterQueries.getFullName === 'function') {
                var full = CharacterQueries.getFullName(char);
                if (full && full.trim() !== '') { return full; }
            }
        } catch (e) {
            // Fall through.
        }
        return '';
    }

    // ============================================================
    // SEARCH
    // ============================================================

    /**
     * Search every character for the given text.
     *
     * @param {string} text
     * @returns {object} {
     *   query: string,            // raw input
     *   normalizedQuery: string,  // lowercased, accent-stripped
     *   groups: [
     *     {
     *       characterId: string,
     *       displayName: string,
     *       matches: [
     *         {
     *           fieldPath: string,
     *           fieldLabel: string,
     *           fieldKey: number|null,
     *           snippet: string,
     *           matchStart: number,
     *           matchEnd: number
     *         }
     *       ]
     *     }
     *   ],
     *   totalMatches: number,
     *   totalCharacters: number
     * }
     */
    function search(text) {
        var rawQuery = (text === undefined || text === null)
            ? ''
            : String(text);

        var normalisedQuery = normalise(rawQuery).trim();

        if (normalisedQuery === '') {
            return {
                query: rawQuery,
                normalizedQuery: '',
                groups: [],
                totalMatches: 0,
                totalCharacters: 0
            };
        }

        var characters = [];
        try {
            characters = CharacterQueries.getCharacters() || [];
        } catch (e) {
            characters = [];
        }

        var groups = [];
        var totalMatches = 0;

        for (var i = 0; i < characters.length; i++) {
            var char = characters[i];
            if (!char || !char.id) { continue; }

            var matches = matchCharacter(
                char, normalisedQuery, rawQuery
            );
            if (matches.length === 0) { continue; }

            groups.push({
                characterId: String(char.id),
                displayName: getDisplayName(char),
                matches: matches
            });

            totalMatches += matches.length;
        }

        groups.sort(function(a, b) {
            var aCount = a.matches.length;
            var bCount = b.matches.length;
            if (aCount !== bCount) { return bCount - aCount; }
            return a.displayName.localeCompare(b.displayName);
        });

        return {
            query: rawQuery,
            normalizedQuery: normalisedQuery,
            groups: groups,
            totalMatches: totalMatches,
            totalCharacters: groups.length
        };
    }

    function matchCharacter(char, normalisedQuery, rawQuery) {
        var matches = [];

        // Synthetic identity fields. getDisplayName and getFullName
        // are derived, not stored, so they are handled explicitly
        // rather than through the RESEARCH_FIELDS walker.
        var displayName = getDisplayName(char);
        var fullName = getFullName(char);

        var identityCandidates = [
            { path: 'name',     label: 'Name',      value: displayName },
            { path: 'fullName', label: 'Full Name', value: fullName }
        ];

        for (var idIdx = 0;
             idIdx < identityCandidates.length;
             idIdx++) {
            var idCand = identityCandidates[idIdx];
            if (!idCand.value) { continue; }
            var idSnip = buildSnippet(
                idCand.value, normalisedQuery
            );
            if (idSnip) {
                matches.push({
                    fieldPath: idCand.path,
                    fieldLabel: idCand.label,
                    fieldKey: null,
                    snippet: idSnip.snippet,
                    matchStart: idSnip.matchStart,
                    matchEnd: idSnip.matchEnd
                });
            }
        }

        // Stored fields.
        var seenIdentity = Object.create(null);
        seenIdentity['name'] = true;
        seenIdentity['fullName'] = true;

        for (var f = 0; f < RESEARCH_FIELDS.length; f++) {
            var field = RESEARCH_FIELDS[f];
            if (seenIdentity[field.path]) { continue; }

            var candidates = resolveField(char, field.path);
            for (var c = 0; c < candidates.length; c++) {
                var candidate = candidates[c];
                var snip = buildSnippet(
                    candidate.raw, normalisedQuery
                );
                if (!snip) { continue; }

                matches.push({
                    fieldPath: field.path,
                    fieldLabel: field.label,
                    fieldKey: candidate.key,
                    snippet: snip.snippet,
                    matchStart: snip.matchStart,
                    matchEnd: snip.matchEnd
                });
            }
        }

        matches.sort(function(a, b) {
            var pathCmp = a.fieldPath.localeCompare(b.fieldPath);
            if (pathCmp !== 0) { return pathCmp; }
            var aKey = a.fieldKey === null ? -1 : a.fieldKey;
            var bKey = b.fieldKey === null ? -1 : b.fieldKey;
            return aKey - bKey;
        });

        return matches;
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.ResearchQueries = Object.freeze({
        search: search,

        // Exposed for tests and for the view's field-label lookup.
        RESEARCH_FIELDS: RESEARCH_FIELDS.slice(),
        normalise: normalise
    });

    // ============================================================
    // VERIFICATION
    // ============================================================

    (function verify() {
        var exports = window.ResearchQueries;
        var missing = [];

        if (typeof exports.search !== 'function') {
            missing.push('search');
        }

        try {
            // Empty input returns empty result.
            var empty = search('');
            if (empty.totalMatches !== 0 ||
                empty.totalCharacters !== 0 ||
                !Array.isArray(empty.groups)) {
                missing.push('search(\'\') did not return empty shape');
            }

            // Null/undefined behave like empty.
            var nulled = search(null);
            if (nulled.totalMatches !== 0) {
                missing.push('search(null) did not return empty shape');
            }
            var undef = search(undefined);
            if (undef.totalMatches !== 0) {
                missing.push('search(undefined) did not return ' +
                    'empty shape');
            }

            // Accent normalisation.
            var a = normalise('C\u00f4ben');
            var b = normalise('coben');
            if (a !== b) {
                missing.push('accent normalisation failed: ' +
                    JSON.stringify(a) + ' !== ' + JSON.stringify(b));
            }

            // Snippet positions.
            var snip = buildSnippet(
                'Likes beasts and long walks',
                'beast'
            );
            if (!snip) {
                missing.push('snippet failed to match "beast"');
            } else {
                var inSnippet = snip.snippet.substring(
                    snip.matchStart, snip.matchEnd
                );
                if (inSnippet.toLowerCase() !== 'beast') {
                    missing.push(
                        'snippet match span is wrong: "' +
                        inSnippet + '"'
                    );
                }
            }

            // Field resolution for scalars and arrays.
            var fake = {
                title: 'Beast Handler',
                personality: { likes: 'beasts' },
                careerStatus: [
                    { status: 'junior', title: '' },
                    { status: 'support', title: 'Beast Keeper' }
                ]
            };
            var titleCands = resolveField(fake, 'title');
            if (titleCands.length !== 1 ||
                titleCands[0].raw !== 'Beast Handler') {
                missing.push('resolveField scalar failed');
            }
            var likesCands = resolveField(
                fake, 'personality.likes'
            );
            if (likesCands.length !== 1 ||
                likesCands[0].raw !== 'beasts') {
                missing.push('resolveField nested failed');
            }
            var statusCands = resolveField(
                fake, 'careerStatus[].title'
            );
            if (statusCands.length !== 1 ||
                statusCands[0].raw !== 'Beast Keeper' ||
                statusCands[0].key !== 1) {
                missing.push('resolveField array failed');
            }
        } catch (e) {
            missing.push('smoke test threw: ' + e.message);
        }

        if (missing.length > 0) {
            console.warn(
                '[ResearchQueries] Verification failed:',
                missing.join(', ')
            );
        }
    })();

})();
