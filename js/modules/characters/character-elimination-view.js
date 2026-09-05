/**
 * modules/characters/character-elimination-view.js - Character Elimination View
 * Renders tournament and standalone eliminations for characters
 * Path: js/modules/characters/character-elimination-view.js
 * 
 * This module is responsible for:
 *   - Rendering tournament eliminations
 *   - Rendering standalone eliminations
 *   - Displaying elimination status
 *   - Managing elimination UI state
 * 
 * IMPORTANT:
 *   - RENDER ONLY - no mutations, no persistence
 *   - No direct window.data access - uses CharacterQueries
 *   - Uses TournamentQueries for tournament lookup
 *   - Uses DomUtils for safe DOM operations
 *   - All user-controlled content uses textContent
 *   - No event binding here (delegated to CharacterEvents)
 * 
 * DEPENDENCIES:
 *   - window.CharacterQueries (from character-queries.js) - MANDATORY
 *   - window.TournamentQueries (from tournament-queries.js) - MANDATORY
 *   - window.DomUtils (from dom-utils.js) - MANDATORY
 *   - window.CALENDAR_CONSTANTS (from constants.js) - MANDATORY
 * 
 * USAGE:
 *   var EV = window.CharacterEliminationView;
 *   EV.renderTournamentEliminations(char);
 *   EV.renderStandaloneEliminations(char);
 *   EV.renderEliminationStatus(char, week);
 */

(function() {
    'use strict';

    // Guard against duplicate loading
    if (window.__characterEliminationViewLoaded) {
        return;
    }
    window.__characterEliminationViewLoaded = true;

    // ============================================================
    // DEPENDENCY IMPORTS - MANDATORY (no fallbacks)
    // ============================================================

    var CharacterQueries = window.CharacterQueries;
    var TournamentQueries = window.TournamentQueries;
    var DomUtils = window.DomUtils;
    var CalendarConstants = window.CALENDAR_CONSTANTS;

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

        if (!CharacterQueries || typeof CharacterQueries.getCharacterById !== 'function') {
            missing.push('CharacterQueries.getCharacterById');
        }
        if (!CharacterQueries || typeof CharacterQueries.getDisplayName !== 'function') {
            missing.push('CharacterQueries.getDisplayName');
        }

        if (!DomUtils || typeof DomUtils.createElement !== 'function') {
            missing.push('DomUtils.createElement');
        }

        if (missing.length > 0) {
            console.warn('[CharacterEliminationView] Missing dependencies:', missing.join(', '));
            return false;
        }

        return true;
    }

    // ============================================================
    // ELIMINATION HELPERS
    // ============================================================

    /**
     * Get tournament eliminations from a character.
     * 
     * @param {object} char - Character object
     * @returns {Array} Array of tournament eliminations
     */
    function getTournamentEliminations(char) {
        if (!char || !Array.isArray(char.eliminations)) {
            return [];
        }

        return char.eliminations.filter(function(e) {
            return e && !e.standalone;
        });
    }

    /**
     * Get standalone eliminations from a character.
     * 
     * @param {object} char - Character object
     * @returns {Array} Array of standalone eliminations
     */
    function getStandaloneEliminations(char) {
        if (!char || !Array.isArray(char.eliminations)) {
            return [];
        }

        return char.eliminations.filter(function(e) {
            return e && e.standalone;
        });
    }

    /**
     * Get all eliminations from a character.
     * 
     * @param {object} char - Character object
     * @returns {Array} Array of all eliminations
     */
    function getAllEliminations(char) {
        if (!char || !Array.isArray(char.eliminations)) {
            return [];
        }

        return char.eliminations.slice();
    }

    /**
     * Check if a character is eliminated by a given week.
     * 
     * @param {object} char - Character object
     * @param {number} week - Week number
     * @returns {boolean} True if eliminated
     */
    function isEliminatedByWeek(char, week) {
        if (!char) return false;

        var weekNum = Number(week);
        if (!Number.isInteger(weekNum) || weekNum < MIN_WEEK) {
            return false;
        }

        var eliminations = Array.isArray(char.eliminations) ? char.eliminations : [];

        for (var i = 0; i < eliminations.length; i++) {
            var elimWeek = Number(eliminations[i].week);
            if (Number.isInteger(elimWeek) &&
                elimWeek >= MIN_WEEK &&
                elimWeek <= MAX_WEEK &&
                elimWeek <= weekNum) {
                return true;
            }
        }

        // Check death timeline
        if (char.deceased) {
            var deathWeekNum = Number(char.deathWeek);
            var hasValidDeathWeek = (
                char.deathWeek !== undefined &&
                char.deathWeek !== null &&
                char.deathWeek !== '' &&
                Number.isInteger(deathWeekNum) &&
                deathWeekNum >= MIN_WEEK &&
                deathWeekNum <= MAX_WEEK
            );

            if (hasValidDeathWeek) {
                return deathWeekNum <= weekNum;
            }

            // Deceased with missing or invalid deathWeek = unavailable entirely
            return true;
        }

        return false;
    }

    /**
     * Get the week when a character was eliminated.
     * Returns the earliest elimination week or death week.
     * 
     * @param {object} char - Character object
     * @returns {number|null} Elimination week or null
     */
    function getEliminationWeek(char) {
        if (!char) return null;

        var eliminations = Array.isArray(char.eliminations) ? char.eliminations : [];
        var earliestWeek = null;

        for (var i = 0; i < eliminations.length; i++) {
            var week = Number(eliminations[i].week);
            if (Number.isInteger(week) && week >= MIN_WEEK && week <= MAX_WEEK) {
                if (earliestWeek === null || week < earliestWeek) {
                    earliestWeek = week;
                }
            }
        }

        // Check death
        if (char.deceased) {
            var deathWeekNum = Number(char.deathWeek);
            var hasValidDeathWeek = (
                char.deathWeek !== undefined &&
                char.deathWeek !== null &&
                char.deathWeek !== '' &&
                Number.isInteger(deathWeekNum) &&
                deathWeekNum >= MIN_WEEK &&
                deathWeekNum <= MAX_WEEK
            );

            if (hasValidDeathWeek) {
                if (earliestWeek === null || deathWeekNum < earliestWeek) {
                    earliestWeek = deathWeekNum;
                }
            } else {
                // Deceased with invalid deathWeek - consider eliminated from week 1
                if (earliestWeek === null || 1 < earliestWeek) {
                    earliestWeek = 1;
                }
            }
        }

        return earliestWeek;
    }

    /**
     * Get the reason for elimination.
     * Returns the first elimination reason or death cause.
     * 
     * @param {object} char - Character object
     * @returns {string} Elimination reason
     */
    function getEliminationReason(char) {
        if (!char) return 'Unknown';

        var eliminations = Array.isArray(char.eliminations) ? char.eliminations : [];

        for (var i = 0; i < eliminations.length; i++) {
            if (eliminations[i] && eliminations[i].reason) {
                return eliminations[i].reason;
            }
        }

        if (char.deceased && char.deathCause) {
            return 'Deceased: ' + char.deathCause;
        }

        if (char.deceased) {
            return 'Deceased';
        }

        return 'Unknown';
    }

    // ============================================================
    // RENDER TOURNAMENT ELIMINATIONS
    // ============================================================

    /**
     * Render tournament eliminations for a character.
     * 
     * @param {object} char - Character object
     * @param {HTMLElement} container - Container element (optional)
     */
    function renderTournamentEliminations(char, container) {
        if (!container) {
            container = document.getElementById('tournament-eliminations-view');
        }
        if (!container) return;

        // Clear container
        container.textContent = '';

        if (!char) {
            var empty = createEmptyState('No character selected');
            container.appendChild(empty);
            return;
        }

        var tournElims = getTournamentEliminations(char);

        if (tournElims.length === 0) {
            var empty = createEmptyState('No tournament eliminations recorded.');
            container.appendChild(empty);
            return;
        }

        tournElims.forEach(function(elim) {
            var tournName = getTournamentName(elim.tournamentId);

            var div = document.createElement('div');
            div.className = 'tournament-elimination-entry';
            div.style.cssText = 'display:flex;justify-content:space-between;align-items:center;padding:4px 8px;background:var(--info-soft);border-radius:4px;margin-bottom:2px;border-left:3px solid var(--info);';

            var span = document.createElement('span');
            span.style.cssText = 'font-size:0.75rem;';

            var strong = document.createElement('strong');
            strong.textContent = tournName;
            span.appendChild(strong);

            var weekText = document.createTextNode(' - Week ' + elim.week);
            span.appendChild(weekText);

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

    /**
     * Render standalone eliminations for a character.
     * 
     * @param {object} char - Character object
     * @param {HTMLElement} container - Container element (optional)
     */
    function renderStandaloneEliminations(char, container) {
        if (!container) {
            container = document.getElementById('standalone-eliminations-container');
        }
        if (!container) return;

        // Clear container
        container.textContent = '';

        if (!char) {
            var empty = createEmptyState('No character selected');
            container.appendChild(empty);
            return;
        }

        var standaloneItems = getStandaloneEliminations(char);

        if (standaloneItems.length === 0) {
            var empty = createEmptyState('No standalone eliminations recorded.');
            container.appendChild(empty);
            return;
        }

        standaloneItems.forEach(function(elim) {
            var div = document.createElement('div');
            div.className = 'standalone-elimination-entry';
            div.style.cssText = 'display:flex;justify-content:space-between;align-items:center;padding:4px 8px;background:var(--warning-soft);border-radius:4px;margin-bottom:2px;border-left:3px solid var(--warning);';
            div.dataset.eliminationId = elim.id;

            var span = document.createElement('span');
            span.style.cssText = 'font-size:0.75rem;';

            var weekText = document.createTextNode('Week ' + elim.week);
            span.appendChild(weekText);

            if (elim.reason) {
                var reasonSpan = document.createTextNode(' - ' + elim.reason);
                span.appendChild(reasonSpan);
            }

            var labelSpan = document.createElement('span');
            labelSpan.style.cssText = 'color:var(--warning);font-size:0.6rem;margin-left:4px;';
            labelSpan.textContent = '[Standalone]';
            span.appendChild(labelSpan);

            var button = document.createElement('button');
            button.className = 'remove-standalone-elim small';
            button.style.cssText = 'background:none;border:none;color:var(--danger);cursor:pointer;font-size:0.6rem;padding:0 4px;';
            button.dataset.id = elim.id;
            button.textContent = '✕';
            button.setAttribute('aria-label', 'Remove elimination');

            div.appendChild(span);
            div.appendChild(button);
            container.appendChild(div);
        });
    }

    // ============================================================
    // RENDER ELIMINATION STATUS
    // ============================================================

    /**
     * Render elimination status for a character.
     * 
     * @param {object} char - Character object
     * @param {number} week - Current week
     * @param {HTMLElement} container - Container element (optional)
     */
    function renderEliminationStatus(char, week, container) {
        if (!container) {
            container = document.getElementById('elimination-status-view');
        }
        if (!container) return;

        // Clear container
        container.textContent = '';

        if (!char) {
            var empty = createEmptyState('No character selected');
            container.appendChild(empty);
            return;
        }

        var weekNum = Number(week) || 1;
        var isEliminated = isEliminatedByWeek(char, weekNum);
        var elimWeek = getEliminationWeek(char);
        var reason = getEliminationReason(char);

        var div = document.createElement('div');
        div.style.cssText = 'padding:6px 10px;background:var(--bg);border-radius:4px;border-left:3px solid ' +
            (isEliminated ? 'var(--danger)' : 'var(--accent)') + ';font-size:0.75rem;';

        if (isEliminated) {
            var icon = document.createElement('span');
            icon.textContent = '⚠ ';
            icon.style.cssText = 'color:var(--danger);';
            div.appendChild(icon);

            var text = document.createTextNode('Eliminated');
            div.appendChild(text);

            if (elimWeek !== null) {
                var weekSpan = document.createElement('span');
                weekSpan.style.cssText = 'color:var(--text-dim);font-size:0.65rem;margin-left:4px;';
                weekSpan.textContent = ' (Week ' + elimWeek + ')';
                div.appendChild(weekSpan);
            }

            if (reason && reason !== 'Unknown') {
                var reasonSpan = document.createElement('span');
                reasonSpan.style.cssText = 'color:var(--text-dim);font-size:0.65rem;margin-left:4px;';
                reasonSpan.textContent = ' - ' + reason;
                div.appendChild(reasonSpan);
            }
        } else {
            var icon = document.createElement('span');
            icon.textContent = '✓ ';
            icon.style.cssText = 'color:var(--accent);';
            div.appendChild(icon);

            var text = document.createTextNode('Not eliminated');
            div.appendChild(text);

            var statusSpan = document.createElement('span');
            statusSpan.style.cssText = 'color:var(--text-dim);font-size:0.65rem;margin-left:4px;';
            statusSpan.textContent = '(Week ' + weekNum + ')';
            div.appendChild(statusSpan);
        }

        container.appendChild(div);
    }

    // ============================================================
    // RENDER ELIMINATION FORM HELPERS
    // ============================================================

    /**
     * Render elimination form controls.
     * Creates the week input and reason input.
     * 
     * @param {HTMLElement} container - Container element (optional)
     * @param {object} options - Options
     * @param {number} options.defaultWeek - Default week value
     * @param {string} options.defaultReason - Default reason value
     */
    function renderEliminationForm(container, options) {
        if (!container) {
            container = document.getElementById('elimination-form-container');
        }
        if (!container) return;

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
        weekInput.style.cssText = 'width:60px;padding:4px 6px;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:4px;font-size:0.7rem;';
        weekWrapper.appendChild(weekInput);

        container.appendChild(weekWrapper);

        // Reason field
        var reasonWrapper = document.createElement('div');
        reasonWrapper.style.cssText = 'display:flex;align-items:center;gap:8px;margin-top:4px;';

        var reasonLabel = document.createElement('label');
        reasonLabel.textContent = 'Reason:';
        reasonLabel.style.cssText = 'font-size:0.7rem;color:var(--text-dim);';
        reasonWrapper.appendChild(reasonLabel);

        var reasonInput = document.createElement('input');
        reasonInput.type = 'text';
        reasonInput.id = 'standalone-elim-reason';
        reasonInput.placeholder = 'e.g., Dropped out';
        reasonInput.value = defaultReason;
        reasonInput.style.cssText = 'flex:1;padding:4px 6px;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:4px;font-size:0.7rem;';
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

    /**
     * Get tournament name by ID.
     * 
     * @param {string} tournamentId - Tournament ID
     * @returns {string} Tournament name
     */
    function getTournamentName(tournamentId) {
        if (!tournamentId) return 'Unknown Tournament';

        if (TournamentQueries && typeof TournamentQueries.getTournamentById === 'function') {
            var tourn = TournamentQueries.getTournamentById(tournamentId);
            if (tourn) return tourn.name || 'Unknown Tournament';
        }

        return 'Unknown Tournament';
    }

    /**
     * Create an empty state element.
     * 
     * @param {string} message - Empty state message
     * @returns {HTMLElement} Empty state element
     */
    function createEmptyState(message) {
        var el = document.createElement('p');
        el.className = 'empty-state';
        el.style.cssText = 'padding:6px;font-size:0.75rem;color:var(--text-dim);';
        el.textContent = message || 'None';
        return el;
    }

    /**
     * Validate a week value.
     * 
     * @param {*} value - Week value to validate
     * @returns {boolean} True if valid
     */
    function validateWeek(value) {
        var num = Number(value);
        return Number.isInteger(num) && num >= MIN_WEEK && num <= MAX_WEEK;
    }

    /**
     * Get the current week from application state.
     * 
     * @returns {number} Current week
     */
    function getCurrentWeek() {
        if (window.data && typeof window.data.currentWeek === 'number') {
            return window.data.currentWeek;
        }
        return 1;
    }

    /**
     * Get eliminated characters for a given week.
     * 
     * @param {number} week - Week number
     * @param {Array} characters - Array of characters
     * @returns {Array} Array of eliminated character IDs
     */
    function getEliminatedCharacters(week, characters) {
        var weekNum = Number(week);
        if (!Number.isInteger(weekNum) || weekNum < MIN_WEEK) {
            return [];
        }

        characters = characters || [];
        var result = [];

        for (var i = 0; i < characters.length; i++) {
            var char = characters[i];
            if (isEliminatedByWeek(char, weekNum)) {
                result.push(char.id);
            }
        }

        return result;
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

        // Queries
        getTournamentEliminations: getTournamentEliminations,
        getStandaloneEliminations: getStandaloneEliminations,
        getAllEliminations: getAllEliminations,
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