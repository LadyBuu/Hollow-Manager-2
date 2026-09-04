/**
 * js/modules/characters/character-eliminations.js - Character Eliminations
 * Handles tournament and standalone eliminations for characters
 * Path: js/modules/characters/character-eliminations.js
 * 
 * This module is responsible for:
 *   - Rendering tournament eliminations
 *   - Rendering standalone eliminations
 *   - Adding standalone eliminations (with VALIDATE → SNAPSHOT → MUTATE → SAVE → LOG → UI COMMIT)
 *   - Removing standalone eliminations (with VALIDATE → SNAPSHOT → MUTATE → SAVE → LOG → UI COMMIT)
 *   - Marking/unmarking tournament eliminations (programmatic)
 *   - Querying elimination status
 * 
 * IMPORTANT: All mutations follow the correct pattern:
 *   VALIDATE → SNAPSHOT → MUTATE → SAVE → LOG (failure-safe) → UI COMMIT
 *   All user-controlled data is inserted using DOM APIs (textContent).
 *   eliminatedWeeks is derived from eliminations to maintain consistency.
 *   Death handling: deceased characters are eliminated from the timeline.
 *   Death and elimination records are combined for availability checks.
 *   Death with invalid deathWeek = unavailable entirely (fail-closed).
 *   USES CharacterQueries for character data and display names
 *   USES MutationUtils for backup and persistence
 *   USES NotificationSystem for notifications
 *   USES ActivityLog for activity logging
 *   USES DomUtils for safe DOM operations
 *   USES TournamentQueries for tournament lookup
 * 
 * ELIMINATION SOURCES OF TRUTH:
 *   1. eliminations array - explicit elimination records (tournament or standalone)
 *   2. deceased + deathWeek - character death as a timeline boundary
 *   - BOTH are checked in isCharacterEliminatedByWeek()
 *   - eliminatedWeeks is DERIVED, never the source of truth
 * 
 * DECEASED HANDLING:
 *   - If a character has a valid deathWeek (1-52), they are eliminated from that week onward.
 *   - If a character is deceased but has no deathWeek, they are considered
 *     eliminated for all timeline weeks (week 1 onward).
 *   - If a character is deceased with invalid deathWeek, they are considered
 *     eliminated for all timeline weeks (fail-closed).
 *   - This is a deliberate data policy: deceased without valid deathWeek = permanently unavailable.
 *   - Death has priority: if deceased, explicit eliminations are still tracked but death
 *     determines availability from its week onward.
 * 
 * DEPENDENCIES:
 *   - window.CharacterQueries (from character-queries.js)
 *   - window.TournamentQueries (from tournaments-queries.js)
 *   - window.MutationUtils (from mutation-utils.js)
 *   - window.NotificationSystem (from notification.js)
 *   - window.ActivityLog (from activity-log.js)
 *   - window.DomUtils (from dom-utils.js)
 *   - window.getCurrentEditId (from index.js)
 *   - window.saveData (from database.js)
 *   - window.CALENDAR_CONSTANTS (from constants.js)
 */

(function() {
    'use strict';

    // Guard against duplicate script loading
    if (window.__characterEliminationsLoaded) {
        return;
    }
    window.__characterEliminationsLoaded = true;

    // ============================================================
    // DEPENDENCY IMPORTS - MANDATORY (no fallbacks)
    // ============================================================

    var CharacterQueries = window.CharacterQueries;
    var TournamentQueries = window.TournamentQueries || window;
    var MutationUtils = window.MutationUtils;
    var NotificationSystem = window.NotificationSystem;
    var ActivityLog = window.ActivityLog;
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

        var required = [
            { name: 'getCurrentEditId', obj: window, methods: ['getCurrentEditId'] },
            { name: 'saveData', obj: window, methods: ['saveData'] },
            { name: 'CharacterQueries', obj: CharacterQueries, methods: ['getCharacterById', 'getDisplayName'] },
            { name: 'MutationUtils', obj: MutationUtils, methods: ['createSafeBackup', 'saveWithPromise'] },
            { name: 'NotificationSystem', obj: NotificationSystem, methods: ['notify'] },
            { name: 'DomUtils', obj: DomUtils, methods: ['escapeHtml'] }
        ];

        required.forEach(function(req) {
            if (!req.obj) {
                missing.push(req.name + ' (not loaded)');
                return;
            }
            req.methods.forEach(function(method) {
                if (typeof req.obj[method] !== 'function') {
                    missing.push(req.name + '.' + method);
                }
            });
        });

        if (missing.length > 0) {
            console.warn('CharacterEliminations: Missing dependencies:', missing.join(', '));
            return false;
        }
        return true;
    }

    // ============================================================
    // NOTIFICATION - Uses NotificationSystem (SINGLE SOURCE OF TRUTH)
    // ============================================================

    function showNotification(message, type) {
        type = type || 'info';
        if (NotificationSystem && typeof NotificationSystem.notify === 'function') {
            NotificationSystem.notify(message, type);
        } else if (type === 'error') {
            alert('Error: ' + message);
        } else {
            alert(message);
        }
    }

    // ============================================================
    // HTML ESCAPING - Delegates to DomUtils (SINGLE SOURCE OF TRUTH)
    // ============================================================

    function escapeHtml(value) {
        if (DomUtils && typeof DomUtils.escapeHtml === 'function') {
            return DomUtils.escapeHtml(value);
        }
        // Emergency fallback (should never be reached)
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
    // ACTIVITY LOGGING - Uses ActivityLog (SINGLE SOURCE OF TRUTH)
    // ============================================================

    function recordActivity(message) {
        try {
            if (ActivityLog && typeof ActivityLog.record === 'function') {
                ActivityLog.record(message);
            }
        } catch (e) {
            // Ignore logging errors
        }
    }

    // ============================================================
    // SAFE BACKUP - Uses MutationUtils (SINGLE SOURCE OF TRUTH)
    // ============================================================

    function createSafeBackup(data) {
        if (MutationUtils && typeof MutationUtils.createSafeBackup === 'function') {
            return MutationUtils.createSafeBackup(data);
        }
        // Emergency fallback (should never be reached)
        try {
            if (window.db && typeof window.db.createSafeCopy === 'function') {
                return window.db.createSafeCopy(data);
            }
            if (typeof structuredClone === 'function') {
                return structuredClone(data);
            }
            return JSON.parse(JSON.stringify(data));
        } catch (err) {
            console.warn('CharacterEliminations: Failed to create backup:', err);
            return null;
        }
    }

    // ============================================================
    // SAFE RENDER HELPERS (with error logging)
    // ============================================================

    function safeRenderCharacterList() {
        if (window.CharacterList && typeof window.CharacterList.render === 'function') {
            try {
                window.CharacterList.render();
            } catch (err) {
                console.error('CharacterEliminations: Failed to render character list:', err);
            }
        }
    }

    function safeShowCharacterForm(id) {
        if (typeof window.showCharacterForm === 'function') {
            try {
                window.showCharacterForm(id);
            } catch (err) {
                console.error('CharacterEliminations: Failed to show character form:', err);
            }
        }
    }

    function safeUpdateDashboardStats() {
        if (typeof window.updateDashboardStats === 'function') {
            try {
                window.updateDashboardStats();
            } catch (err) {
                console.error('CharacterEliminations: Failed to update dashboard stats:', err);
            }
        }
    }

    function getCurrentEditId() {
        if (typeof window.getCurrentEditId === 'function') {
            return window.getCurrentEditId();
        }
        return null;
    }

    // ============================================================
    // GENERATE ELIMINATION ID
    // ============================================================

    function generateEliminationId() {
        if (window.IdUtils && typeof window.IdUtils.generateId === 'function') {
            return window.IdUtils.generateId('elim');
        }
        if (window.crypto && typeof window.crypto.randomUUID === 'function') {
            return 'elim_' + window.crypto.randomUUID();
        }
        return 'elim_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
    }

    // ============================================================
    // REBUILD ELIMINATED WEEKS - Derived from eliminations
    // ============================================================

    /**
     * Rebuild the eliminatedWeeks array from eliminations.
     * This is a DERIVED field - it should never be the source of truth.
     * Does NOT mutate eliminations, only eliminatedWeeks.
     * 
     * @param {object} char - Character object
     */
    function rebuildEliminatedWeeks(char) {
        if (!char) return;

        if (!Array.isArray(char.eliminations)) {
            char.eliminations = [];
        }

        char.eliminatedWeeks = [];

        char.eliminations.forEach(function(e) {
            var week = Number(e.week);
            // Only include valid weeks within range
            if (Number.isInteger(week) && week >= MIN_WEEK && week <= MAX_WEEK) {
                if (char.eliminatedWeeks.indexOf(week) === -1) {
                    char.eliminatedWeeks.push(week);
                }
            }
        });

        char.eliminatedWeeks.sort(function(a, b) { return a - b; });
    }

    // ============================================================
    // VALIDATE WEEK - STRICT
    // ============================================================

    function validateWeek(week) {
        var num = Number(week);
        return Number.isInteger(num) && num >= MIN_WEEK && num <= MAX_WEEK;
    }

    // ============================================================
    // IS CHARACTER ELIMINATED BY WEEK
    // Combines explicit elimination records with death timeline data.
    // Death with invalid deathWeek = unavailable entirely (fail-closed).
    // Accepts future weeks for timeline queries.
    // 
    // @param {object} char - Character object
    // @param {number} week - Week number
    // @returns {boolean} True if eliminated by or before the given week
    // ============================================================

    function isCharacterEliminatedByWeek(char, week) {
        if (!char) return false;

        var weekNum = Number(week);
        if (!Number.isInteger(weekNum) || weekNum < MIN_WEEK) {
            return false;
        }

        // Check explicit elimination records FIRST - only valid weeks
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

        // Then check death timeline
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

    // ============================================================
    // GET ELIMINATED CHARACTERS
    // ============================================================

    function getEliminatedCharacters(week) {
        var weekNum = Number(week);
        if (!Number.isInteger(weekNum) || weekNum < MIN_WEEK) {
            return [];
        }

        var result = [];
        var data = window.data || {};
        var chars = data.characters || [];

        chars.forEach(function(char) {
            if (isCharacterEliminatedByWeek(char, weekNum)) {
                result.push(char.id);
            }
        });
        return result;
    }

    // ============================================================
    // RENDER ELIMINATIONS - DOM-based for safety
    // ============================================================

    function renderTournamentEliminations(char) {
        var container = document.getElementById('tournament-eliminations-view');
        if (!container) return;

        var tournElims = [];
        if (char.eliminations) {
            tournElims = char.eliminations.filter(function(e) { return !e.standalone; });
        }

        container.textContent = '';

        if (tournElims.length === 0) {
            var empty = document.createElement('p');
            empty.className = 'empty-state';
            empty.style.cssText = 'padding:6px;font-size:0.75rem;';
            empty.textContent = 'No tournament eliminations recorded.';
            container.appendChild(empty);
            return;
        }

        var data = window.data || {};

        tournElims.forEach(function(elim) {
            var tournName = 'Unknown Tournament';
            if (elim.tournamentId) {
                var tourn = TournamentQueries && typeof TournamentQueries.getTournamentById === 'function'
                    ? TournamentQueries.getTournamentById(elim.tournamentId)
                    : null;
                if (tourn) tournName = tourn.name;
            }

            var div = document.createElement('div');
            div.style.cssText = 'display:flex;justify-content:space-between;align-items:center;padding:4px 8px;background:var(--info-soft);border-radius:4px;margin-bottom:2px;border-left:3px solid var(--info);';

            var span = document.createElement('span');
            span.style.cssText = 'font-size:0.75rem;';
            var strong = document.createElement('strong');
            strong.textContent = tournName;
            span.appendChild(strong);
            var textNode = document.createTextNode(' - Week ' + elim.week);
            span.appendChild(textNode);
            if (elim.reason) {
                var reasonSpan = document.createElement('span');
                reasonSpan.textContent = ' (' + elim.reason + ')';
                span.appendChild(reasonSpan);
            }

            div.appendChild(span);
            container.appendChild(div);
        });
    }

    function renderStandaloneEliminations(char) {
        var container = document.getElementById('standalone-eliminations-container');
        if (!container) return;

        var standaloneItems = [];
        if (char.eliminations) {
            char.eliminations.forEach(function(elim) {
                if (elim.standalone) {
                    standaloneItems.push({
                        elimination: elim,
                        id: elim.id
                    });
                }
            });
        }

        container.textContent = '';

        if (standaloneItems.length === 0) {
            var empty = document.createElement('p');
            empty.className = 'empty-state';
            empty.style.cssText = 'padding:6px;font-size:0.75rem;';
            empty.textContent = 'No standalone eliminations recorded.';
            container.appendChild(empty);
            return;
        }

        standaloneItems.forEach(function(item) {
            var elim = item.elimination;
            var id = item.id;

            var div = document.createElement('div');
            div.style.cssText = 'display:flex;justify-content:space-between;align-items:center;padding:4px 8px;background:var(--warning-soft);border-radius:4px;margin-bottom:2px;border-left:3px solid var(--warning);';

            var span = document.createElement('span');
            span.style.cssText = 'font-size:0.75rem;';
            span.textContent = 'Week ' + elim.week;
            if (elim.reason) {
                var reasonSpan = document.createTextNode(' - ' + elim.reason);
                span.appendChild(reasonSpan);
            }
            var standaloneLabel = document.createElement('span');
            standaloneLabel.style.cssText = 'color:var(--warning);font-size:0.6rem;margin-left:4px;';
            standaloneLabel.textContent = '[Standalone]';
            span.appendChild(standaloneLabel);

            var button = document.createElement('button');
            button.className = 'remove-standalone-elim small';
            button.style.cssText = 'background:none;border:none;color:var(--danger);cursor:pointer;font-size:0.6rem;padding:0 4px;';
            button.dataset.id = id;
            button.textContent = '✕';

            div.appendChild(span);
            div.appendChild(button);
            container.appendChild(div);
        });
    }

    // ============================================================
    // ADD STANDALONE ELIMINATION - Full mutation pipeline
    // ============================================================

    function addStandaloneElimination() {
        if (!checkDependencies()) {
            showNotification('Dependencies not loaded. Please refresh the page.', 'error');
            return;
        }

        var charId = getCurrentEditId();
        if (!charId) {
            showNotification('Please select a character first.', 'error');
            return;
        }

        var weekInput = document.getElementById('standalone-elim-week');
        var reasonInput = document.getElementById('standalone-elim-reason');

        if (!weekInput) {
            showNotification('Form error: Missing week input. Please refresh the page.', 'error');
            return;
        }

        var week = Number(weekInput.value);
        var reason = reasonInput ? reasonInput.value.trim() || 'Dropped out' : 'Dropped out';

        if (!validateWeek(week)) {
            showNotification('Please enter a valid week (1-52).', 'error');
            return;
        }

        var data = window.data || {};
        if (!data.characters) {
            showNotification('Character data not found.', 'error');
            return;
        }

        var char = data.characters.find(function(c) { return String(c.id) === String(charId); });
        if (!char) {
            showNotification('Character not found.', 'error');
            return;
        }

        if (isCharacterEliminatedByWeek(char, week)) {
            showNotification('This character is already eliminated at or before week ' + week + '.', 'error');
            return;
        }

        var name = CharacterQueries.getDisplayName(char);
        if (!confirm('Eliminate ' + name + ' at week ' + week + '?\nReason: ' + reason)) {
            return;
        }

        // ---- PHASE 1: SNAPSHOT - Required, abort if fails ----
        var backup = createSafeBackup(data);
        if (!backup) {
            showNotification('Unable to safely eliminate character. Please try again.', 'error');
            return;
        }

        // ---- PHASE 2: MUTATE ----
        if (!char.eliminations) char.eliminations = [];
        if (!char.eliminatedWeeks) char.eliminatedWeeks = [];

        var newElimination = {
            id: generateEliminationId(),
            tournamentId: null,
            week: week,
            reason: reason,
            standalone: true,
            fromMatch: false
        };
        char.eliminations.push(newElimination);

        rebuildEliminatedWeeks(char);

        // ---- PHASE 3: PERSIST ----
        var savePromise = MutationUtils.saveWithPromise();

        savePromise
            .then(function() {
                // ---- PHASE 4: LOG - failure-safe, persistence already succeeded ----
                try {
                    recordActivity('Eliminated ' + name + ' (standalone, week ' + week + '): ' + reason);
                } catch (logErr) {
                    // Ignore logging errors
                }

                // ---- PHASE 5: UI COMMIT ----
                onAddSuccess(charId);
            })
            .catch(function(err) {
                // ---- PHASE 6: ROLLBACK ----
                if (backup) {
                    window.data = backup;
                    safeRenderCharacterList();
                    safeShowCharacterForm(charId);
                }
                showNotification('Failed to add elimination. Please try again.', 'error');
            });
    }

    function onAddSuccess(charId) {
        safeRenderCharacterList();
        safeUpdateDashboardStats();
        safeShowCharacterForm(charId);
        showNotification('Character eliminated successfully!', 'success');
    }

    // ============================================================
    // REMOVE STANDALONE ELIMINATION - BY ID
    // ============================================================

    function removeStandaloneElimination(charId, eliminationId) {
        if (!checkDependencies()) {
            showNotification('Dependencies not loaded. Please refresh the page.', 'error');
            return;
        }

        if (!charId || !eliminationId) {
            showNotification('Invalid parameters.', 'error');
            return;
        }

        if (!confirm('Remove this standalone elimination?')) return;

        var data = window.data || {};
        if (!data.characters) {
            showNotification('Character data not found.', 'error');
            return;
        }

        var char = data.characters.find(function(c) { return String(c.id) === String(charId); });
        if (!char || !char.eliminations) {
            showNotification('Character or elimination not found.', 'error');
            return;
        }

        var elim = char.eliminations.find(function(e) {
            return e.standalone && String(e.id) === String(eliminationId);
        });

        if (!elim) {
            showNotification('Elimination not found.', 'error');
            return;
        }

        // ---- PHASE 1: SNAPSHOT - Required, abort if fails ----
        var backup = createSafeBackup(data);
        if (!backup) {
            showNotification('Unable to safely remove elimination. Please try again.', 'error');
            return;
        }

        // ---- PHASE 2: MUTATE - filter by ID ----
        char.eliminations = char.eliminations.filter(function(e) {
            return !(e.standalone && String(e.id) === String(eliminationId));
        });
        rebuildEliminatedWeeks(char);

        // ---- PHASE 3: PERSIST ----
        var name = CharacterQueries.getDisplayName(char);
        var savePromise = MutationUtils.saveWithPromise();

        savePromise
            .then(function() {
                // ---- PHASE 4: LOG - failure-safe, persistence already succeeded ----
                try {
                    recordActivity('Removed standalone elimination for ' + name + ' (week ' + elim.week + ')');
                } catch (logErr) {
                    // Ignore logging errors
                }

                // ---- PHASE 5: UI COMMIT ----
                onRemoveSuccess(charId);
            })
            .catch(function(err) {
                // ---- PHASE 6: ROLLBACK ----
                if (backup) {
                    window.data = backup;
                    safeRenderCharacterList();
                    safeShowCharacterForm(charId);
                }
                showNotification('Failed to remove elimination. Please try again.', 'error');
            });
    }

    function onRemoveSuccess(charId) {
        safeRenderCharacterList();
        safeUpdateDashboardStats();
        safeShowCharacterForm(charId);
        showNotification('Standalone elimination removed.', 'success');
    }

    // ============================================================
    // TOURNAMENT ELIMINATION HELPERS
    // ============================================================

    function markCharacterEliminated(charId, tournamentId, week, reason) {
        if (!checkDependencies()) {
            console.warn('markCharacterEliminated: Dependencies not loaded');
            return Promise.resolve(false);
        }

        if (tournamentId === null || tournamentId === undefined || tournamentId === '') {
            console.warn('markCharacterEliminated: Missing tournament ID');
            return Promise.resolve(false);
        }

        if (!validateWeek(week)) {
            console.warn('markCharacterEliminated: Invalid week "' + week + '" - aborting');
            return Promise.resolve(false);
        }

        var data = window.data || {};
        if (!data.characters) {
            return Promise.resolve(false);
        }

        var char = data.characters.find(function(c) { return String(c.id) === String(charId); });
        if (!char) {
            return Promise.resolve(false);
        }

        var weekNum = Number(week);

        if (isCharacterEliminatedByWeek(char, weekNum)) {
            return Promise.resolve(false);
        }

        var alreadyExists = char.eliminations && char.eliminations.some(function(e) {
            return !e.standalone && String(e.tournamentId) === String(tournamentId);
        });

        if (alreadyExists) {
            return Promise.resolve(false);
        }

        // ---- PHASE 1: SNAPSHOT - Required, abort if fails ----
        var backup = createSafeBackup(data);
        if (!backup) {
            showNotification('Unable to safely mark character eliminated. Please try again.', 'error');
            return Promise.resolve(false);
        }

        // ---- PHASE 2: MUTATE ----
        if (!char.eliminations) char.eliminations = [];
        if (!char.eliminatedWeeks) char.eliminatedWeeks = [];

        char.eliminations.push({
            id: generateEliminationId(),
            tournamentId: tournamentId,
            week: weekNum,
            reason: reason || 'Eliminated from tournament',
            standalone: false,
            fromMatch: true
        });

        rebuildEliminatedWeeks(char);

        // ---- PHASE 3: PERSIST ----
        var name = CharacterQueries.getDisplayName(char);
        var savePromise = MutationUtils.saveWithPromise();

        return savePromise
            .then(function() {
                // ---- PHASE 4: LOG - failure-safe, persistence already succeeded ----
                try {
                    var tournName = 'Unknown Tournament';
                    if (tournamentId) {
                        var tourn = TournamentQueries && typeof TournamentQueries.getTournamentById === 'function'
                            ? TournamentQueries.getTournamentById(tournamentId)
                            : null;
                        if (tourn) tournName = tourn.name;
                    }
                    recordActivity(name + ' eliminated from ' + tournName + ' (week ' + weekNum + ')');
                } catch (logErr) {
                    // Ignore logging errors
                }

                // ---- PHASE 5: UI COMMIT ----
                safeRenderCharacterList();
                safeUpdateDashboardStats();
                return true;
            })
            .catch(function(err) {
                // ---- PHASE 6: ROLLBACK ----
                if (backup) {
                    window.data = backup;
                    safeRenderCharacterList();
                }
                showNotification('Failed to mark character eliminated. Please try again.', 'error');
                return false;
            });
    }

    function unmarkCharacterEliminated(charId, tournamentId) {
        if (!checkDependencies()) {
            console.warn('unmarkCharacterEliminated: Dependencies not loaded');
            return Promise.resolve(false);
        }

        if (tournamentId === null || tournamentId === undefined || tournamentId === '') {
            console.warn('unmarkCharacterEliminated: Missing tournament ID');
            return Promise.resolve(false);
        }

        var data = window.data || {};
        if (!data.characters) {
            return Promise.resolve(false);
        }

        var char = data.characters.find(function(c) { return String(c.id) === String(charId); });
        if (!char) {
            return Promise.resolve(false);
        }

        var hasMatchingElimination = char.eliminations && char.eliminations.some(function(e) {
            return String(e.tournamentId) === String(tournamentId) && !e.standalone;
        });

        if (!hasMatchingElimination) {
            return Promise.resolve(false);
        }

        // ---- PHASE 1: SNAPSHOT - Required, abort if fails ----
        var backup = createSafeBackup(data);
        if (!backup) {
            showNotification('Unable to safely unmark character eliminated. Please try again.', 'error');
            return Promise.resolve(false);
        }

        // ---- PHASE 2: MUTATE ----
        if (char.eliminations) {
            char.eliminations = char.eliminations.filter(function(e) {
                return !(String(e.tournamentId) === String(tournamentId) && !e.standalone);
            });
        }

        rebuildEliminatedWeeks(char);

        // ---- PHASE 3: PERSIST ----
        var name = CharacterQueries.getDisplayName(char);
        var savePromise = MutationUtils.saveWithPromise();

        return savePromise
            .then(function() {
                // ---- PHASE 4: LOG - failure-safe, persistence already succeeded ----
                try {
                    var tournName = 'Unknown Tournament';
                    if (tournamentId) {
                        var tourn = TournamentQueries && typeof TournamentQueries.getTournamentById === 'function'
                            ? TournamentQueries.getTournamentById(tournamentId)
                            : null;
                        if (tourn) tournName = tourn.name;
                    }
                    recordActivity('Restored ' + name + ' from ' + tournName);
                } catch (logErr) {
                    // Ignore logging errors
                }

                // ---- PHASE 5: UI COMMIT ----
                safeRenderCharacterList();
                safeUpdateDashboardStats();
                return true;
            })
            .catch(function(err) {
                // ---- PHASE 6: ROLLBACK ----
                if (backup) {
                    window.data = backup;
                    safeRenderCharacterList();
                }
                showNotification('Failed to unmark character eliminated. Please try again.', 'error');
                return false;
            });
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.CharacterEliminations = {
        // Rendering
        renderTournament: renderTournamentEliminations,
        renderStandalone: renderStandaloneEliminations,

        // Mutations
        addStandalone: addStandaloneElimination,
        removeStandalone: removeStandaloneElimination,

        // Tournament elimination helpers
        markCharacterEliminated: markCharacterEliminated,
        unmarkCharacterEliminated: unmarkCharacterEliminated,

        // Queries
        isCharacterEliminatedByWeek: isCharacterEliminatedByWeek,
        getEliminatedCharacters: getEliminatedCharacters,

        // Utilities
        rebuildEliminatedWeeks: rebuildEliminatedWeeks,
        validateWeek: validateWeek,

        // Constants
        MIN_WEEK: MIN_WEEK,
        MAX_WEEK: MAX_WEEK
    };

})();
