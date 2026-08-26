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
 * 
 * IMPORTANT: All mutations follow the correct pattern:
 *   MUTATE → LOG → SAVE
 *   All user-controlled data is escaped to prevent XSS.
 *   eliminatedWeeks is derived from eliminations to maintain consistency.
 *   Deceased characters are considered eliminated from their death week onward.
 */

(function() {
    'use strict';

    // Guard against duplicate script loading
    if (window.__characterEliminationsLoaded) {
        return;
    }
    window.__characterEliminationsLoaded = true;

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
            var week = parseInt(e.week);
            if (!isNaN(week) && char.eliminatedWeeks.indexOf(week) === -1) {
                char.eliminatedWeeks.push(week);
            }
        });
        
        char.eliminatedWeeks.sort(function(a, b) { return a - b; });
    }

    // ============================================================
    // VALIDATE WEEK
    // ============================================================

    function validateWeek(week) {
        var num = parseInt(week);
        return !isNaN(num) && num >= 1 && num <= 52;
    }

    // ============================================================
    // CHECK ELIMINATED BY WEEK - WITH DECEASED TIMELINE
    // ============================================================

    function isCharacterEliminatedByWeek(char, week) {
        if (!char) return false;
        
        var weekNum = parseInt(week) || 1;
        
        // Check if deceased and death occurred at or before this week
        if (char.deceased) {
            // If deathWeek is stored, use it
            if (char.deathWeek !== undefined && char.deathWeek !== null && char.deathWeek !== '') {
                var deathWeek = parseInt(char.deathWeek);
                if (!isNaN(deathWeek) && deathWeek <= weekNum) {
                    return true;
                }
            }
            // If deathAge is stored, derive death week from birthYear + deathAge
            if (char.birthYear && char.deathAge) {
                var birthYear = parseInt(char.birthYear);
                var deathAge = parseInt(char.deathAge);
                if (!isNaN(birthYear) && !isNaN(deathAge)) {
                    var derivedDeathWeek = birthYear + deathAge;
                    if (derivedDeathWeek <= weekNum) {
                        return true;
                    }
                }
            }
            // If no death timeline info, assume deceased means eliminated from all weeks
            return true;
        }
        
        // Check elimination records
        if (char.eliminatedWeeks && char.eliminatedWeeks.length > 0) {
            for (var i = 0; i < char.eliminatedWeeks.length; i++) {
                var elimWeek = parseInt(char.eliminatedWeeks[i]);
                if (!isNaN(elimWeek) && elimWeek <= weekNum) {
                    return true;
                }
            }
        }
        return false;
    }

    // ============================================================
    // CHECK ELIMINATED BY WEEK (DIRECT) - Uses eliminations directly
    // ============================================================

    function isCharacterEliminatedDirect(char, week) {
        if (!char) return false;
        
        var weekNum = parseInt(week) || 1;
        
        // Check deceased with timeline
        if (char.deceased) {
            if (char.deathWeek !== undefined && char.deathWeek !== null && char.deathWeek !== '') {
                var deathWeek = parseInt(char.deathWeek);
                if (!isNaN(deathWeek) && deathWeek <= weekNum) {
                    return true;
                }
            }
            if (char.birthYear && char.deathAge) {
                var birthYear = parseInt(char.birthYear);
                var deathAge = parseInt(char.deathAge);
                if (!isNaN(birthYear) && !isNaN(deathAge)) {
                    var derivedDeathWeek = birthYear + deathAge;
                    if (derivedDeathWeek <= weekNum) {
                        return true;
                    }
                }
            }
            return true;
        }
        
        // Check eliminations directly
        if (char.eliminations) {
            for (var i = 0; i < char.eliminations.length; i++) {
                var elimWeek = parseInt(char.eliminations[i].week);
                if (!isNaN(elimWeek) && elimWeek <= weekNum) {
                    return true;
                }
            }
        }
        return false;
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
                    return String(t.id) === String(elim.tournamentId); 
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
            char.eliminations.forEach(function(elim, index) {
                if (elim.standalone) {
                    standaloneItems.push({
                        elimination: elim,
                        originalIndex: index,
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
            var originalIndex = item.originalIndex;
            var id = item.id;

            html += '<div style="display:flex;justify-content:space-between;align-items:center;padding:4px 8px;background:var(--warning-soft);border-radius:4px;margin-bottom:2px;border-left:3px solid var(--warning);">';
            html += '<span style="font-size:0.75rem;">Week ' + escapeHtml(elim.week) + (elim.reason ? ' - ' + escapeHtml(elim.reason) : '') + ' <span style="color:var(--warning);font-size:0.6rem;">[Standalone]</span></span>';
            html += '<button class="remove-standalone-elim small" style="background:none;border:none;color:var(--danger);cursor:pointer;font-size:0.6rem;padding:0 4px;" data-index="' + originalIndex + '" data-id="' + escapeHtml(id) + '">✕</button>';
            html += '</div>';
        });
        container.innerHTML = html;

        container.querySelectorAll('.remove-standalone-elim').forEach(function(btn) {
            btn.addEventListener('click', function() {
                var id = getCurrentEditId();
                var index = parseInt(this.dataset.index);
                if (id !== null && !isNaN(index)) {
                    removeStandaloneElimination(id, index);
                }
            });
        });
    }

    // ============================================================
    // ADD STANDALONE ELIMINATION
    // ============================================================

    function addStandaloneElimination() {
        var charId = getCurrentEditId();
        if (!charId) {
            alert('Please select a character first.');
            return;
        }

        var weekInput = document.getElementById('standalone-elim-week');
        var reasonInput = document.getElementById('standalone-elim-reason');
        
        var week = weekInput ? parseInt(weekInput.value) || 1 : 1;
        var reason = reasonInput ? reasonInput.value.trim() || 'Dropped out' : 'Dropped out';

        // Validate week
        if (!validateWeek(week)) {
            alert('Week must be between 1 and 52.');
            return;
        }

        var data = window.data || {};
        if (!data.characters) {
            alert('Character data not found.');
            return;
        }

        var char = data.characters.find(function(c) { return String(c.id) === String(charId); });
        if (!char) {
            alert('Character not found.');
            return;
        }

        // Check if already eliminated at or before this week (using direct elimination check)
        if (isCharacterEliminatedDirect(char, week)) {
            alert('This character is already eliminated at or before week ' + week + '.');
            return;
        }

        var backup = window.ExportUtils ? window.ExportUtils.cloneData(data) : null;

        // 1. MUTATE
        if (!char.eliminations) char.eliminations = [];
        if (!char.eliminatedWeeks) char.eliminatedWeeks = [];

        char.eliminations.push({
            id: generateEliminationId(),
            tournamentId: null,
            week: week,
            reason: reason,
            standalone: true,
            fromMatch: false
        });

        rebuildEliminatedWeeks(char);

        // 2. LOG
        var name = window.getDisplayName(char);
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
                    alert('Failed to add elimination. Please try again.');
                });
        } else {
            onAddSuccess(charId);
        }
    }

    function onAddSuccess(charId) {
        safeRenderCharacterList();
        safeUpdateDashboardStats();
        safeShowCharacterForm(charId);
        alert('Character eliminated successfully!');
    }

    // ============================================================
    // REMOVE STANDALONE ELIMINATION
    // ============================================================

    function removeStandaloneElimination(charId, index) {
        if (!confirm('Remove this standalone elimination?')) return;
        
        var data = window.data || {};
        if (!data.characters) {
            alert('Character data not found.');
            return;
        }

        var char = data.characters.find(function(c) { return String(c.id) === String(charId); });
        if (!char || !char.eliminations) {
            alert('Character or elimination not found.');
            return;
        }

        var elim = char.eliminations[index];
        if (!elim || !elim.standalone) {
            alert('Elimination not found or is not standalone.');
            return;
        }

        var backup = window.ExportUtils ? window.ExportUtils.cloneData(data) : null;

        // 1. MUTATE
        char.eliminations.splice(index, 1);
        rebuildEliminatedWeeks(char);

        // 2. LOG
        var name = window.getDisplayName(char);
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
                    alert('Failed to remove elimination. Please try again.');
                });
        } else {
            onRemoveSuccess(charId);
        }
    }

    function onRemoveSuccess(charId) {
        safeRenderCharacterList();
        safeUpdateDashboardStats();
        safeShowCharacterForm(charId);
        alert('Standalone elimination removed.');
    }

    // ============================================================
    // TOURNAMENT ELIMINATION HELPERS - FIXED
    // ============================================================

    function markCharacterEliminated(charId, tournamentId, week, reason) {
        // Validate week
        if (!validateWeek(week)) {
            console.warn('markCharacterEliminated: Invalid week "' + week + '", using 1');
            week = 1;
        }

        var data = window.data || {};
        if (!data.characters) return;

        var char = data.characters.find(function(c) { return String(c.id) === String(charId); });
        if (!char) return;

        var weekNum = parseInt(week) || 1;

        // Check if already eliminated at or before this week
        if (isCharacterEliminatedDirect(char, weekNum)) {
            console.log('markCharacterEliminated: Character already eliminated by week ' + weekNum);
            return;
        }

        // Check if this specific tournament already has an elimination
        var alreadyExists = char.eliminations && char.eliminations.some(function(e) {
            return !e.standalone && String(e.tournamentId) === String(tournamentId);
        });

        if (alreadyExists) {
            console.log('markCharacterEliminated: Character already eliminated from this tournament');
            return;
        }

        var backup = window.ExportUtils ? window.ExportUtils.cloneData(data) : null;

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
        var name = window.getDisplayName(char);
        if (typeof window.logActivity === 'function') {
            var tournName = 'Unknown Tournament';
            if (tournamentId && data.tournaments) {
                var tourn = data.tournaments.find(function(t) { 
                    return String(t.id) === String(tournamentId); 
                });
                if (tourn) tournName = tourn.name;
            }
            window.logActivity(name + ' eliminated from ' + tournName + ' (week ' + weekNum + ')');
        }

        // 3. SAVE
        if (typeof window.saveData === 'function') {
            window.saveData()
                .then(function() {
                    safeRenderCharacterList();
                    safeUpdateDashboardStats();
                })
                .catch(function(err) {
                    console.error('Failed to mark character eliminated:', err);
                    if (backup) {
                        window.data = backup;
                        safeRenderCharacterList();
                    }
                    alert('Failed to mark character eliminated. Please try again.');
                });
        } else {
            safeRenderCharacterList();
            safeUpdateDashboardStats();
        }
    }

    function unmarkCharacterEliminated(charId, tournamentId) {
        var data = window.data || {};
        if (!data.characters) return;

        var char = data.characters.find(function(c) { return String(c.id) === String(charId); });
        if (!char) return;

        // Check if anything will be removed
        var hasMatchingElimination = char.eliminations && char.eliminations.some(function(e) {
            return String(e.tournamentId) === String(tournamentId) && !e.standalone;
        });

        if (!hasMatchingElimination) {
            console.log('unmarkCharacterEliminated: No matching elimination found');
            return;
        }

        var backup = window.ExportUtils ? window.ExportUtils.cloneData(data) : null;

        // 1. MUTATE
        if (char.eliminations) {
            char.eliminations = char.eliminations.filter(function(e) {
                return !(String(e.tournamentId) === String(tournamentId) && !e.standalone);
            });
        }

        rebuildEliminatedWeeks(char);

        // 2. LOG
        var name = window.getDisplayName(char);
        if (typeof window.logActivity === 'function') {
            var tournName = 'Unknown Tournament';
            if (tournamentId && data.tournaments) {
                var tourn = data.tournaments.find(function(t) { 
                    return String(t.id) === String(tournamentId); 
                });
                if (tourn) tournName = tourn.name;
            }
            window.logActivity('Restored ' + name + ' from ' + tournName);
        }

        // 3. SAVE
        if (typeof window.saveData === 'function') {
            window.saveData()
                .then(function() {
                    safeRenderCharacterList();
                    safeUpdateDashboardStats();
                })
                .catch(function(err) {
                    console.error('Failed to unmark character eliminated:', err);
                    if (backup) {
                        window.data = backup;
                        safeRenderCharacterList();
                    }
                    alert('Failed to unmark character eliminated. Please try again.');
                });
        } else {
            safeRenderCharacterList();
            safeUpdateDashboardStats();
        }
    }

    // ============================================================
    // QUERY FUNCTIONS
    // ============================================================

    function getEliminatedCharacters(week) {
        var weekNum = parseInt(week) || 1;
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
    // EXPOSE
    // ============================================================

    window.CharacterEliminations = {
        renderTournament: renderTournamentEliminations,
        renderStandalone: renderStandaloneEliminations,
        addStandalone: addStandaloneElimination,
        removeStandalone: removeStandaloneElimination,
        markCharacterEliminated: markCharacterEliminated,
        unmarkCharacterEliminated: unmarkCharacterEliminated,
        isCharacterEliminatedByWeek: isCharacterEliminatedByWeek,
        getEliminatedCharacters: getEliminatedCharacters,
        rebuildEliminatedWeeks: rebuildEliminatedWeeks
    };

})();
