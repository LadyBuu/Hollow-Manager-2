/**
 * js/modules/characters/character-eliminations.js - Character Eliminations
 * Handles tournament and standalone eliminations for characters
 * Path: js/modules/characters/character-eliminations.js
 * 
 * This module is responsible for:
 *   - Rendering tournament eliminations
 *   - Rendering standalone eliminations
 *   - Adding standalone eliminations (with MUTATE → LOG → SAVE)
 *   - Removing standalone eliminations (with MUTATE → LOG → SAVE)
 *   - Marking/unmarking tournament eliminations (programmatic)
 *   - Querying elimination status
 * 
 * IMPORTANT: All mutations follow the correct pattern:
 *   MUTATE → LOG → SAVE
 *   All user-controlled data is escaped to prevent XSS.
 *   eliminatedWeeks is derived from eliminations to maintain consistency.
 *   All mutations use candidate-based validation with rollback on failure.
 * 
 * ELIMINATION SOURCES OF TRUTH:
 *   1. eliminations array - explicit elimination records (tournament or standalone)
 *   2. deceased + deathWeek - character death as a timeline boundary
 * 
 * DECEASED HANDLING:
 *   - If a character has a deathWeek, they are eliminated from that week onward.
 *   - If a character is deceased but has no deathWeek, they are considered
 *     eliminated for all timeline weeks (week 1 onward).
 *   - This is a deliberate data policy: deceased without deathWeek = permanently unavailable.
 * 
 * DEPENDENCIES:
 *   - window.getCharacterById (from core-utils.js)
 *   - window.getDisplayName (from core-utils.js)
 *   - window.currentEditId (from index.js)
 *   - window.saveData (from database.js)
 *   - window.logActivity (from core-utils.js)
 *   - window.db.createSafeCopy (from database.js)
 */

(function() {
    'use strict';

    // Guard against duplicate script loading
    if (window.__characterEliminationsLoaded) {
        return;
    }
    window.__characterEliminationsLoaded = true;

    // ============================================================
    // CONSTANTS
    // ============================================================

    var MIN_WEEK = 1;
    var MAX_WEEK = 52;

    // ============================================================
    // DEPENDENCY CHECK
    // ============================================================

    function checkDependencies() {
        var required = [
            'getCharacterById',
            'getDisplayName',
            'currentEditId',
            'saveData',
            'logActivity'
        ];

        var missing = [];
        required.forEach(function(name) {
            if (name === 'currentEditId' && typeof window.currentEditId !== 'function') {
                missing.push('currentEditId');
            } else if (name === 'saveData' && typeof window.saveData !== 'function') {
                missing.push('saveData');
            } else if (name === 'logActivity' && typeof window.logActivity !== 'function') {
                missing.push('logActivity');
            } else if (typeof window[name] !== 'function' && 
                       name !== 'currentEditId' &&
                       name !== 'saveData' &&
                       name !== 'logActivity') {
                missing.push(name);
            }
        });

        if (missing.length > 0) {
            console.warn('CharacterEliminations: Missing dependencies:', missing.join(', '));
            return false;
        }
        return true;
    }

    // ============================================================
    // HTML ESCAPING - Prevents XSS
    // ============================================================

    function escapeHtml(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    // ============================================================
    // NOTIFICATION SYSTEM
    // ============================================================

    function showNotification(message, type) {
        type = type || 'info';

        if (typeof window.showToast === 'function') {
            window.showToast(message, type);
            return;
        }

        if (typeof window.setSession === 'function') {
            window.setSession('toast', {
                message: message,
                type: type,
                timestamp: Date.now()
            });
            if (typeof window.renderToast === 'function') {
                window.renderToast();
            }
            return;
        }

        // Ultimate fallback - only use alert for errors
        if (type === 'error') {
            alert('Error: ' + message);
        } else {
            alert(message);
        }
    }

    // ============================================================
    // SAFE BACKUP - Using database module's clone
    // ============================================================

    function createSafeBackup(data) {
        try {
            if (window.db && typeof window.db.createSafeCopy === 'function') {
                return window.db.createSafeCopy(data);
            }
            if (typeof structuredClone === 'function') {
                return structuredClone(data);
            }
            // Fallback - may fail for complex objects but better than nothing
            try {
                return JSON.parse(JSON.stringify(data));
            } catch (e) {
                console.warn('CharacterEliminations: Failed to create backup:', e);
                return null;
            }
        } catch (err) {
            console.warn('CharacterEliminations: Failed to create backup:', err);
            return null;
        }
    }

    // ============================================================
    // SAFE RENDER HELPERS
    // ============================================================

    function safeRenderCharacterList() {
        if (window.CharacterList && typeof window.CharacterList.render === 'function') {
            window.CharacterList.render();
        }
    }

    function safeShowCharacterForm(id) {
        if (typeof window.showCharacterForm === 'function') {
            window.showCharacterForm(id);
        }
    }

    function safeUpdateDashboardStats() {
        if (typeof window.updateDashboardStats === 'function') {
            window.updateDashboardStats();
        }
    }

    function getCurrentEditId() {
        if (typeof window.currentEditId === 'function') {
            return window.currentEditId();
        }
        return null;
    }

    // ============================================================
    // GENERATE ELIMINATION ID
    // ============================================================

    function generateEliminationId() {
        return 'elim_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
    }

    // ============================================================
    // REBUILD ELIMINATED WEEKS - Derived from eliminations
    // ============================================================

    function rebuildEliminatedWeeks(char) {
        if (!char) return;

        char.eliminatedWeeks = [];

        if (!char.eliminations) {
            char.eliminations = [];
            return;
        }

        char.eliminations.forEach(function(e) {
            var week = Number(e.week);
            if (Number.isInteger(week) && char.eliminatedWeeks.indexOf(week) === -1) {
                char.eliminatedWeeks.push(week);
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
    // ============================================================

    function isCharacterEliminatedByWeek(char, week) {
        if (!char) return false;

        var weekNum = Number(week);
        if (!Number.isInteger(weekNum) || weekNum < MIN_WEEK) {
            return false;
        }

        // DECEASED HANDLING
        if (char.deceased) {
            // If deathWeek is stored, use it as the timeline boundary
            if (
                char.deathWeek !== undefined &&
                char.deathWeek !== null &&
                char.deathWeek !== ''
            ) {
                var deathWeek = Number(char.deathWeek);
                if (Number.isInteger(deathWeek) && deathWeek <= weekNum) {
                    return true;
                }
                // Death occurs in the future relative to this week
                return false;
            }

            // If a deceased character has no death-week information,
            // assume they are unavailable for all timeline weeks.
            // This is a deliberate data policy choice.
            return true;
        }

        // Check elimination records (source of truth for explicit eliminations)
        if (char.eliminations) {
            for (var i = 0; i < char.eliminations.length; i++) {
                var elimWeek = Number(char.eliminations[i].week);
                if (Number.isInteger(elimWeek) && elimWeek <= weekNum) {
                    return true;
                }
            }
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
    // TOURNAMENT ELIMINATIONS - RENDER
    // ============================================================

    function renderTournamentEliminations(char) {
        var container = document.getElementById('tournament-eliminations-view');
        if (!container) return;

        var tournElims = [];
        if (char.eliminations) {
            tournElims = char.eliminations.filter(function(e) { return !e.standalone; });
        }

        if (tournElims.length === 0) {
            container.innerHTML = '<p class="empty-state" style="padding:6px;font-size:0.75rem;">No tournament eliminations recorded.</p>';
            return;
        }

        var html = '';
        var data = window.data || {};
        tournElims.forEach(function(elim) {
            var tournName = 'Unknown Tournament';
            if (elim.tournamentId && data.tournaments) {
                var tourn = data.tournaments.find(function(t) {
                    return t && String(t.id) === String(elim.tournamentId);
                });
                if (tourn) tournName = tourn.name;
            }
            html += '<div style="display:flex;justify-content:space-between;align-items:center;padding:4px 8px;background:var(--info-soft);border-radius:4px;margin-bottom:2px;border-left:3px solid var(--info);">';
            html += '<span style="font-size:0.75rem;"><strong>' + escapeHtml(tournName) + '</strong> - Week ' + escapeHtml(elim.week) + (elim.reason ? ' (' + escapeHtml(elim.reason) + ')' : '') + '</span>';
            html += '</div>';
        });
        container.innerHTML = html;
    }

    // ============================================================
    // STANDALONE ELIMINATIONS - RENDER
    // ============================================================

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

        if (standaloneItems.length === 0) {
            container.innerHTML = '<p class="empty-state" style="padding:6px;font-size:0.75rem;">No standalone eliminations recorded.</p>';
            return;
        }

        var html = '';
        standaloneItems.forEach(function(item) {
            var elim = item.elimination;
            var id = item.id;

            html += '<div style="display:flex;justify-content:space-between;align-items:center;padding:4px 8px;background:var(--warning-soft);border-radius:4px;margin-bottom:2px;border-left:3px solid var(--warning);">';
            html += '<span style="font-size:0.75rem;">Week ' + escapeHtml(elim.week) + (elim.reason ? ' - ' + escapeHtml(elim.reason) : '') + ' <span style="color:var(--warning);font-size:0.6rem;">[Standalone]</span></span>';
            html += '<button class="remove-standalone-elim small" style="background:none;border:none;color:var(--danger);cursor:pointer;font-size:0.6rem;padding:0 4px;" data-id="' + escapeHtml(id) + '">✕</button>';
            html += '</div>';
        });
        container.innerHTML = html;

        // Event listeners are bound via event delegation in character-events.js
    }

    // ============================================================
    // ADD STANDALONE ELIMINATION
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

        // Validate week - strict
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

        // Check if already eliminated at or before this week
        if (isCharacterEliminatedByWeek(char, week)) {
            showNotification('This character is already eliminated at or before week ' + week + '.', 'error');
            return;
        }

        // Confirmation
        var name = typeof window.getDisplayName === 'function' ? window.getDisplayName(char) : char.firstName || 'Character';
        if (!confirm('Eliminate ' + name + ' at week ' + week + '?\nReason: ' + reason)) {
            return;
        }

        var backup = createSafeBackup(data);

        // 1. MUTATE
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

        // 2. LOG
        if (typeof window.logActivity === 'function') {
            window.logActivity('Eliminated ' + name + ' (standalone, week ' + week + '): ' + reason);
        }

        // 3. SAVE
        if (typeof window.saveData === 'function') {
            window.saveData()
                .then(function() {
                    onAddSuccess(charId);
                })
                .catch(function(err) {
                    console.error('Failed to add elimination:', err);
                    if (backup) {
                        window.data = backup;
                        safeRenderCharacterList();
                        safeShowCharacterForm(charId);
                    }
                    showNotification('Failed to add elimination. Please try again.', 'error');
                });
        } else {
            onAddSuccess(charId);
        }
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

        // Find elimination by ID
        var elim = char.eliminations.find(function(e) {
            return e.standalone && String(e.id) === String(eliminationId);
        });

        if (!elim) {
            showNotification('Elimination not found.', 'error');
            return;
        }

        var backup = createSafeBackup(data);

        // 1. MUTATE - filter by ID
        char.eliminations = char.eliminations.filter(function(e) {
            return !(e.standalone && String(e.id) === String(eliminationId));
        });
        rebuildEliminatedWeeks(char);

        // 2. LOG
        var name = typeof window.getDisplayName === 'function' ? window.getDisplayName(char) : char.firstName || 'Character';
        if (typeof window.logActivity === 'function') {
            window.logActivity('Removed standalone elimination for ' + name + ' (week ' + elim.week + ')');
        }

        // 3. SAVE
        if (typeof window.saveData === 'function') {
            window.saveData()
                .then(function() {
                    onRemoveSuccess(charId);
                })
                .catch(function(err) {
                    console.error('Failed to remove elimination:', err);
                    if (backup) {
                        window.data = backup;
                        safeRenderCharacterList();
                        safeShowCharacterForm(charId);
                    }
                    showNotification('Failed to remove elimination. Please try again.', 'error');
                });
        } else {
            onRemoveSuccess(charId);
        }
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

        // Validate tournament ID
        if (tournamentId === null || tournamentId === undefined || tournamentId === '') {
            console.warn('markCharacterEliminated: Missing tournament ID');
            return Promise.resolve(false);
        }

        // Validate week - abort on invalid
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

        // Check if already eliminated at or before this week
        if (isCharacterEliminatedByWeek(char, weekNum)) {
            console.log('markCharacterEliminated: Character already eliminated by week ' + weekNum);
            return Promise.resolve(false);
        }

        // Check if this specific tournament already has an elimination
        var alreadyExists = char.eliminations && char.eliminations.some(function(e) {
            return !e.standalone && String(e.tournamentId) === String(tournamentId);
        });

        if (alreadyExists) {
            console.log('markCharacterEliminated: Character already eliminated from this tournament');
            return Promise.resolve(false);
        }

        var backup = createSafeBackup(data);

        // 1. MUTATE
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

        // 2. LOG
        var name = typeof window.getDisplayName === 'function' ? window.getDisplayName(char) : char.firstName || 'Character';
        if (typeof window.logActivity === 'function') {
            var tournName = 'Unknown Tournament';
            if (tournamentId && data.tournaments) {
                var tourn = data.tournaments.find(function(t) {
                    return t && String(t.id) === String(tournamentId);
                });
                if (tourn) tournName = tourn.name;
            }
            window.logActivity(name + ' eliminated from ' + tournName + ' (week ' + weekNum + ')');
        }

        // 3. SAVE
        if (typeof window.saveData === 'function') {
            return window.saveData()
                .then(function() {
                    safeRenderCharacterList();
                    safeUpdateDashboardStats();
                    return true;
                })
                .catch(function(err) {
                    console.error('Failed to mark character eliminated:', err);
                    if (backup) {
                        window.data = backup;
                        safeRenderCharacterList();
                    }
                    showNotification('Failed to mark character eliminated. Please try again.', 'error');
                    return false;
                });
        } else {
            safeRenderCharacterList();
            safeUpdateDashboardStats();
            return Promise.resolve(true);
        }
    }

    function unmarkCharacterEliminated(charId, tournamentId) {
        if (!checkDependencies()) {
            console.warn('unmarkCharacterEliminated: Dependencies not loaded');
            return Promise.resolve(false);
        }

        // Validate tournament ID
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

        // Check if anything will be removed
        var hasMatchingElimination = char.eliminations && char.eliminations.some(function(e) {
            return String(e.tournamentId) === String(tournamentId) && !e.standalone;
        });

        if (!hasMatchingElimination) {
            console.log('unmarkCharacterEliminated: No matching elimination found');
            return Promise.resolve(false);
        }

        var backup = createSafeBackup(data);

        // 1. MUTATE
        if (char.eliminations) {
            char.eliminations = char.eliminations.filter(function(e) {
                return !(String(e.tournamentId) === String(tournamentId) && !e.standalone);
            });
        }

        rebuildEliminatedWeeks(char);

        // 2. LOG
        var name = typeof window.getDisplayName === 'function' ? window.getDisplayName(char) : char.firstName || 'Character';
        if (typeof window.logActivity === 'function') {
            var tournName = 'Unknown Tournament';
            if (tournamentId && data.tournaments) {
                var tourn = data.tournaments.find(function(t) {
                    return t && String(t.id) === String(tournamentId);
                });
                if (tourn) tournName = tourn.name;
            }
            window.logActivity('Restored ' + name + ' from ' + tournName);
        }

        // 3. SAVE
        if (typeof window.saveData === 'function') {
            return window.saveData()
                .then(function() {
                    safeRenderCharacterList();
                    safeUpdateDashboardStats();
                    return true;
                })
                .catch(function(err) {
                    console.error('Failed to unmark character eliminated:', err);
                    if (backup) {
                        window.data = backup;
                        safeRenderCharacterList();
                    }
                    showNotification('Failed to unmark character eliminated. Please try again.', 'error');
                    return false;
                });
        } else {
            safeRenderCharacterList();
            safeUpdateDashboardStats();
            return Promise.resolve(true);
        }
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
