/**
 * modules/characters/character-elimination-view.js - Character Elimination View
 * Renders tournament and standalone eliminations for characters
 * Path: js/modules/characters/character-elimination-view.js
 *
 * This module is responsible for:
 *   - Rendering tournament eliminations
 *   - Rendering standalone eliminations
 *   - Displaying elimination status
 *   - Managing elimination UI state (form rendering)
 *
 * IMPORTANT:
 *   - RENDER ONLY - no mutations, no persistence
 *   - No direct window.data access - uses CharacterQueries for character data
 *   - Uses TournamentQueries.getTournament for tournament lookup (simple read)
 *   - Uses DomUtils for safe DOM operations
 *   - All user-controlled content uses textContent
 *   - No event binding here (delegated to CharacterEvents)
 *
 * QUERY DELEGATION:
 *   Elimination QUERIES are delegated to EliminationQueries, which is
 *   the single source of truth for elimination read semantics. This
 *   module does NOT reimplement the week boundary, the source-of-
 *   truth rule, or the treatment of deceased characters.
 *
 *   Shape-level filters (getTournamentEliminations,
 *   getStandaloneEliminations, getAllEliminations) are LOCAL: they
 *   are predicates on the eliminations array shape, not semantic
 *   queries about elimination status.
 *
 * ELIMINATION vs DECEASED:
 *   These are separate concepts.
 *     - An ELIMINATION is a competitive-exam outcome.
 *     - DECEASED is a life event.
 *   A character can be deceased without being eliminated, eliminated
 *   without being deceased, both, or neither.
 *
 *   The elimination queries in this module do NOT consult
 *   character.deceased or character.deathWeek. If a caller wants to
 *   ask "is this character dead?", that is a separate question with
 *   its own query (CharacterQueries.isDeceased).
 *
 * WEEK BOUNDARY SEMANTICS:
 *   A character eliminated in week N is ELIGIBLE during week N and
 *   INELIGIBLE from week N+1 onward.
 *
 *   Concretely:
 *     isEliminatedByWeek(char, N)       → false
 *     isEliminatedByWeek(char, N + 1)   → true
 *
 *   EliminationQueries owns this rule. This module delegates.
 *
 * TOURNAMENT LOOKUP:
 *   TournamentQueries exposes getTournament(id). The older
 *   getTournamentById(id) name does not exist and has never existed
 *   in the current TournamentQueries module. Callers must use
 *   getTournament. A missing tournament returns 'Unknown Tournament'.
 *
 * DEPENDENCIES:
 *   - window.CharacterQueries       (from character-queries.js) - MANDATORY
 *   - window.TournamentQueries      (from tournament-queries.js) - MANDATORY
 *   - window.EliminationQueries     (from elimination-queries.js) - MANDATORY
 *   - window.DomUtils               (from dom-utils.js) - MANDATORY
 *   - window.CalendarConstants      (from constants.js) - MANDATORY
 *
 * USAGE:
 *   var EV = window.CharacterEliminationView;
 *   EV.renderTournamentEliminations(char, container);
 *   EV.renderStandaloneEliminations(char, container);
 *   EV.renderEliminationStatus(char, week, container);
 */

(function() {
    'use strict';

    if (window.__characterEliminationViewLoaded) {
        return;
    }
    window.__characterEliminationViewLoaded = true;

    // ============================================================
    // DEPENDENCY IMPORTS - MANDATORY (no fallbacks)
    // ============================================================

    var CharacterQueries = window.CharacterQueries;
    var TournamentQueries = window.TournamentQueries;
    var EliminationQueries = window.EliminationQueries;
    var DomUtils = window.DomUtils;
    var CalendarConstants = window.CalendarConstants;

    // ============================================================
    // CONSTANTS
    // ============================================================

    var MIN_WEEK = CalendarConstants ? CalendarConstants.MIN_WEEK : 1;
    var MAX_WEEK = CalendarConstants ? CalendarConstants.MAX_WEEK : 52;

    // ============================================================
    // DEPENDENCY CHECK
    // ============================================================

    function checkDependencies() {
        var missing = [];

        if (!CharacterQueries ||
            typeof CharacterQueries.getCharacterById !== 'function') {
            missing.push('CharacterQueries.getCharacterById');
        }
        if (!CharacterQueries ||
            typeof CharacterQueries.getDisplayName !== 'function') {
            missing.push('CharacterQueries.getDisplayName');
        }

        if (!TournamentQueries ||
            typeof TournamentQueries.getTournament !== 'function') {
            missing.push('TournamentQueries.getTournament');
        }

        if (!EliminationQueries ||
            typeof EliminationQueries.isCharacterEliminatedByWeek !== 'function') {
            missing.push('EliminationQueries.isCharacterEliminatedByWeek');
        }
        if (!EliminationQueries ||
            typeof EliminationQueries.getEliminationWeek !== 'function') {
            missing.push('EliminationQueries.getEliminationWeek');
        }
        if (!EliminationQueries ||
            typeof EliminationQueries.getEliminationReason !== 'function') {
            missing.push('EliminationQueries.getEliminationReason');
        }
        if (!EliminationQueries ||
            typeof EliminationQueries.getEliminatedCharacters !== 'function') {
            missing.push('EliminationQueries.getEliminatedCharacters');
        }

        if (!DomUtils ||
            typeof DomUtils.createElement !== 'function') {
            missing.push('DomUtils.createElement');
        }

        if (missing.length > 0) {
            console.warn(
                '[CharacterEliminationView] Missing dependencies:',
                missing.join(', ')
            );
            return false;
        }

        return true;
    }

    // ============================================================
    // SHAPE FILTERS - predicates on the eliminations array
    // ============================================================
    //
    // These are NOT semantic queries. They split the eliminations
    // array by record shape:
    //   - standalone: true  → standalone eliminations (dropped out)
    //   - standalone: false → tournament eliminations
    //
    // They do not consult the week boundary or the deceased state.

    function getTournamentEliminations(char) {
        if (!char || !Array.isArray(char.eliminations)) {
            return [];
        }

        var result = [];
        for (var i = 0; i < char.eliminations.length; i++) {
            var e = char.eliminations[i];
            if (e && !e.standalone) {
                result.push(e);
            }
        }
        return result;
    }

    function getStandaloneEliminations(char) {
        if (!char || !Array.isArray(char.eliminations)) {
            return [];
        }

        var result = [];
        for (var i = 0; i < char.eliminations.length; i++) {
            var e = char.eliminations[i];
            if (e && e.standalone) {
                result.push(e);
            }
        }
        return result;
    }

    function getAllEliminations(char) {
        if (!char || !Array.isArray(char.eliminations)) {
            return [];
        }
        return char.eliminations.slice();
    }

    // ============================================================
    // QUERIES - DELEGATED TO EliminationQueries
    // ============================================================

    function isEliminatedByWeek(char, week) {
        return EliminationQueries.isCharacterEliminatedByWeek(char, week);
    }

    function getEliminationWeek(char) {
        return EliminationQueries.getEliminationWeek(char);
    }

    function getEliminationReason(char) {
        return EliminationQueries.getEliminationReason(char);
    }

    function getEliminatedCharacters(week, characters) {
        return EliminationQueries.getEliminatedCharacters(week, characters);
    }

    // ============================================================
    // TOURNAMENT LOOKUP
    // ============================================================

    /**
     * Resolve a tournament ID to its display name.
     *
     * Uses TournamentQueries.getTournament. Returns 'Unknown Tournament'
     * when the ID is missing, the query is unavailable, or the
     * tournament does not exist.
     *
     * @param {string} tournamentId
     * @returns {string}
     */
    function getTournamentName(tournamentId) {
        if (!tournamentId) {
            return 'Unknown Tournament';
        }

        if (!TournamentQueries ||
            typeof TournamentQueries.getTournament !== 'function') {
            return 'Unknown Tournament';
        }

        var tourn = null;
        try {
            tourn = TournamentQueries.getTournament(tournamentId);
        } catch (e) {
            console.warn(
                '[CharacterEliminationView] getTournament failed:',
                tournamentId,
                e
            );
            return 'Unknown Tournament';
        }

        if (tourn) {
            return tourn.name || 'Unknown Tournament';
        }

        return 'Unknown Tournament';
    }

    // ============================================================
    // RENDER TOURNAMENT ELIMINATIONS
    // ============================================================

    function renderTournamentEliminations(char, container) {
        if (!container) {
            container = document.getElementById('tournament-eliminations-view');
        }
        if (!container) {
            return;
        }

        container.textContent = '';

        if (!char) {
            container.appendChild(createEmptyState('No character selected'));
            return;
        }

        var tournElims = getTournamentEliminations(char);

        if (tournElims.length === 0) {
            container.appendChild(
                createEmptyState('No tournament eliminations recorded.')
            );
            return;
        }

        tournElims.forEach(function(elim) {
            var tournName = getTournamentName(elim.tournamentId);

            var div = document.createElement('div');
            div.className = 'tournament-elimination-entry';
            div.style.cssText =
                'display:flex;justify-content:space-between;' +
                'align-items:center;padding:4px 8px;' +
                'background:var(--info-soft);border-radius:4px;' +
                'margin-bottom:2px;border-left:3px solid var(--info);';

            var span = document.createElement('span');
            span.style.cssText = 'font-size:0.75rem;';

            var strong = document.createElement('strong');
            strong.textContent = tournName;
            span.appendChild(strong);

            span.appendChild(
                document.createTextNode(' - Week ' + elim.week)
            );

            if (elim.reason) {
                var reasonSpan = document.createElement('span');
                reasonSpan.textContent = ' (' + elim.reason + ')';
                span.appendChild(reasonSpan);
            }

            div.appendChild(span);
            container.appendChild(div);
        });
    }

    // ============================================================
    // RENDER STANDALONE ELIMINATIONS
    // ============================================================

    function renderStandaloneEliminations(char, container) {
        if (!container) {
            container = document.getElementById('standalone-eliminations-container');
        }
        if (!container) {
            return;
        }

        container.textContent = '';

        if (!char) {
            container.appendChild(createEmptyState('No character selected'));
            return;
        }

        var standaloneItems = getStandaloneEliminations(char);

        if (standaloneItems.length === 0) {
            container.appendChild(
                createEmptyState('No standalone eliminations recorded.')
            );
            return;
        }

        standaloneItems.forEach(function(elim) {
            var div = document.createElement('div');
            div.className = 'standalone-elimination-entry';
            div.style.cssText =
                'display:flex;justify-content:space-between;' +
                'align-items:center;padding:4px 8px;' +
                'background:var(--warning-soft);border-radius:4px;' +
                'margin-bottom:2px;border-left:3px solid var(--warning);';
            div.dataset.eliminationId = elim.id;

            var span = document.createElement('span');
            span.style.cssText = 'font-size:0.75rem;';

            span.appendChild(
                document.createTextNode('Week ' + elim.week)
            );

            if (elim.reason) {
                span.appendChild(
                    document.createTextNode(' - ' + elim.reason)
                );
            }

            var labelSpan = document.createElement('span');
            labelSpan.style.cssText =
                'color:var(--warning);font-size:0.6rem;margin-left:4px;';
            labelSpan.textContent = '[Standalone]';
            span.appendChild(labelSpan);

            var button = document.createElement('button');
            button.className = 'remove-standalone-elim small';
            button.style.cssText =
                'background:none;border:none;color:var(--danger);' +
                'cursor:pointer;font-size:0.6rem;padding:0 4px;';
            button.dataset.id = elim.id;
            button.textContent = '\u2715';
            button.setAttribute('aria-label', 'Remove elimination');

            div.appendChild(span);
            div.appendChild(button);
            container.appendChild(div);
        });
    }

    // ============================================================
    // RENDER ELIMINATION STATUS
    // ============================================================

    function renderEliminationStatus(char, week, container) {
        if (!container) {
            container = document.getElementById('elimination-status-view');
        }
        if (!container) {
            return;
        }

        container.textContent = '';

        if (!char) {
            container.appendChild(createEmptyState('No character selected'));
            return;
        }

        var weekNum = Number(week) || 1;
        var isEliminated = isEliminatedByWeek(char, weekNum);
        var elimWeek = getEliminationWeek(char);
        var reason = getEliminationReason(char);

        var div = document.createElement('div');
        div.style.cssText =
            'padding:6px 10px;background:var(--bg);border-radius:4px;' +
            'border-left:3px solid ' +
            (isEliminated ? 'var(--danger)' : 'var(--accent)') +
            ';font-size:0.75rem;';

        if (isEliminated) {
            var icon = document.createElement('span');
            icon.textContent = '\u26a0 ';
            icon.style.cssText = 'color:var(--danger);';
            div.appendChild(icon);

            div.appendChild(document.createTextNode('Eliminated'));

            if (elimWeek !== null) {
                var weekSpan = document.createElement('span');
                weekSpan.style.cssText =
                    'color:var(--text-dim);font-size:0.65rem;margin-left:4px;';
                weekSpan.textContent = ' (Week ' + elimWeek + ')';
                div.appendChild(weekSpan);
            }

            if (reason && reason !== 'Unknown') {
                var reasonSpan = document.createElement('span');
                reasonSpan.style.cssText =
                    'color:var(--text-dim);font-size:0.65rem;margin-left:4px;';
                reasonSpan.textContent = ' - ' + reason;
                div.appendChild(reasonSpan);
            }
        } else {
            var okIcon = document.createElement('span');
            okIcon.textContent = '\u2713 ';
            okIcon.style.cssText = 'color:var(--accent);';
            div.appendChild(okIcon);

            div.appendChild(document.createTextNode('Not eliminated'));

            // Clarify the boundary: if the character has an
            // elimination at exactly this week, they are still
            // eligible during this week. Show it explicitly so the
            // user understands the strictly-less-than rule.
            if (elimWeek !== null && elimWeek === weekNum) {
                var boundarySpan = document.createElement('span');
                boundarySpan.style.cssText =
                    'color:var(--text-dim);font-size:0.65rem;margin-left:4px;';
                boundarySpan.textContent =
                    '(eliminated at end of week ' + elimWeek + ')';
                div.appendChild(boundarySpan);
            } else {
                var statusSpan = document.createElement('span');
                statusSpan.style.cssText =
                    'color:var(--text-dim);font-size:0.65rem;margin-left:4px;';
                statusSpan.textContent = '(Week ' + weekNum + ')';
                div.appendChild(statusSpan);
            }
        }

        container.appendChild(div);
    }

    // ============================================================
    // RENDER ELIMINATION FORM HELPERS
    // ============================================================

    function renderEliminationForm(container, options) {
        if (!container) {
            container = document.getElementById('elimination-form-container');
        }
        if (!container) {
            return;
        }

        options = options || {};
        var defaultWeek = options.defaultWeek || 1;
        var defaultReason = options.defaultReason || 'Dropped out';

        container.textContent = '';

        // Week field
        var weekWrapper = document.createElement('div');
        weekWrapper.style.cssText = 'display:flex;align-items:center;gap:8px;';

        var weekLabel = document.createElement('label');
        weekLabel.textContent = 'Week:';
        weekLabel.style.cssText = 'font-size:0.7rem;color:var(--text-dim);';
        weekWrapper.appendChild(weekLabel);

        var weekInput = document.createElement('input');
        weekInput.type = 'number';
        weekInput.id = 'standalone-elim-week';
        weekInput.min = MIN_WEEK;
        weekInput.max = MAX_WEEK;
        weekInput.value = defaultWeek;
        weekInput.style.cssText =
            'width:60px;padding:4px 6px;background:var(--bg);' +
            'border:1px solid var(--border);color:var(--text);' +
            'border-radius:4px;font-size:0.7rem;';
        weekWrapper.appendChild(weekInput);

        container.appendChild(weekWrapper);

        // Reason field
        var reasonWrapper = document.createElement('div');
        reasonWrapper.style.cssText =
            'display:flex;align-items:center;gap:8px;margin-top:4px;';

        var reasonLabel = document.createElement('label');
        reasonLabel.textContent = 'Reason:';
        reasonLabel.style.cssText = 'font-size:0.7rem;color:var(--text-dim);';
        reasonWrapper.appendChild(reasonLabel);

        var reasonInput = document.createElement('input');
        reasonInput.type = 'text';
        reasonInput.id = 'standalone-elim-reason';
        reasonInput.placeholder = 'e.g., Dropped out';
        reasonInput.value = defaultReason;
        reasonInput.style.cssText =
            'flex:1;padding:4px 6px;background:var(--bg);' +
            'border:1px solid var(--border);color:var(--text);' +
            'border-radius:4px;font-size:0.7rem;';
        reasonWrapper.appendChild(reasonInput);

        container.appendChild(reasonWrapper);

        // Add button
        var buttonWrapper = document.createElement('div');
        buttonWrapper.style.cssText = 'margin-top:8px;';

        var addBtn = document.createElement('button');
        addBtn.type = 'button';
        addBtn.id = 'add-standalone-elim-btn';
        addBtn.className = 'small warning-btn';
        addBtn.textContent = 'Apply Elimination';
        addBtn.style.cssText = 'padding:4px 12px;font-size:0.7rem;';
        buttonWrapper.appendChild(addBtn);

        container.appendChild(buttonWrapper);
    }

    // ============================================================
    // HELPERS
    // ============================================================

    function createEmptyState(message) {
        var el = document.createElement('p');
        el.className = 'empty-state';
        el.style.cssText =
            'padding:6px;font-size:0.75rem;color:var(--text-dim);';
        el.textContent = message || 'None';
        return el;
    }

    /**
     * Local form-input validator. This is NOT the semantic week
     * query — it just checks whether a value is a valid week number.
     * The semantic queries live in EliminationQueries.
     */
    function validateWeek(value) {
        var num = Number(value);
        return Number.isInteger(num) && num >= MIN_WEEK && num <= MAX_WEEK;
    }

    function getCurrentWeek() {
        if (window.data && typeof window.data.currentWeek === 'number') {
            return window.data.currentWeek;
        }
        return 1;
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.CharacterEliminationView = {
        // Render
        renderTournamentEliminations: renderTournamentEliminations,
        renderStandaloneEliminations: renderStandaloneEliminations,
        renderEliminationStatus: renderEliminationStatus,
        renderEliminationForm: renderEliminationForm,

        // Shape filters (local — predicates on the array shape)
        getTournamentEliminations: getTournamentEliminations,
        getStandaloneEliminations: getStandaloneEliminations,
        getAllEliminations: getAllEliminations,

        // Queries (delegated to EliminationQueries)
        isEliminatedByWeek: isEliminatedByWeek,
        getEliminationWeek: getEliminationWeek,
        getEliminationReason: getEliminationReason,
        getEliminatedCharacters: getEliminatedCharacters,

        // Helpers
        getTournamentName: getTournamentName,
        validateWeek: validateWeek,
        getCurrentWeek: getCurrentWeek,
        createEmptyState: createEmptyState,

        // Constants
        MIN_WEEK: MIN_WEEK,
        MAX_WEEK: MAX_WEEK
    };

})();
