/**
 * js/modules/characters/character-eliminations.js - Character Eliminations
 * Handles tournament and standalone eliminations for characters
 * Path: js/modules/characters/character-eliminations.js
 * 
 * IMPORTANT: All mutations follow the correct pattern:
 *   MUTATE → LOG → SAVE
 *   This ensures activities are persisted with the data change.
 */

(function() {
    'use strict';

    // ============================================================
    // TOURNAMENT ELIMINATIONS
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
            html += '<span style="font-size:0.75rem;"><strong>' + tournName + '</strong> - Week ' + elim.week + (elim.reason ? ' (' + elim.reason + ')' : '') + '</span>';
            html += '</div>';
        });
        container.innerHTML = html;
    }

    // ============================================================
    // STANDALONE ELIMINATIONS
    // ============================================================

    function renderStandaloneEliminations(char) {
        var container = document.getElementById('standalone-eliminations-container');
        if (!container) return;

        var standaloneElims = [];
        if (char.eliminations) {
            standaloneElims = char.eliminations.filter(function(e) { return e.standalone; });
        }

        if (standaloneElims.length === 0) {
            container.innerHTML = '<p class="empty-state" style="padding:6px;font-size:0.75rem;">No standalone eliminations recorded.</p>';
            return;
        }

        var html = '';
        standaloneElims.forEach(function(elim, index) {
            html += '<div style="display:flex;justify-content:space-between;align-items:center;padding:4px 8px;background:var(--warning-soft);border-radius:4px;margin-bottom:2px;border-left:3px solid var(--warning);">';
            html += '<span style="font-size:0.75rem;">Week ' + elim.week + (elim.reason ? ' - ' + elim.reason : '') + ' <span style="color:var(--warning);font-size:0.6rem;">[Standalone]</span></span>';
            html += '<button class="remove-standalone-elim small" style="background:none;border:none;color:var(--danger);cursor:pointer;font-size:0.6rem;padding:0 4px;" data-index="' + index + '">✕</button>';
            html += '</div>';
        });
        container.innerHTML = html;

        container.querySelectorAll('.remove-standalone-elim').forEach(function(btn) {
            btn.addEventListener('click', function() {
                var id = window.currentEditId ? window.currentEditId() : null;
                var index = parseInt(this.dataset.index);
                if (id !== null) {
                    removeStandaloneElimination(id, index);
                }
            });
        });
    }

    // ============================================================
    // ADD STANDALONE ELIMINATION
    // ============================================================

    function addStandaloneElimination() {
        var charId = window.currentEditId ? window.currentEditId() : null;
        if (!charId) {
            alert('Please select a character first.');
            return;
        }

        var weekInput = document.getElementById('standalone-elim-week');
        var reasonInput = document.getElementById('standalone-elim-reason');
        
        var week = parseInt(weekInput ? weekInput.value : 1) || 1;
        var reason = reasonInput ? reasonInput.value.trim() || 'Dropped out' : 'Dropped out';

        var data = window.data || {};
        var char = data.characters.find(function(c) { return String(c.id) === String(charId); });
        if (!char) {
            alert('Character not found.');
            return;
        }

        // Check if already eliminated at or before this week
        var alreadyEliminated = false;
        if (char.eliminatedWeeks) {
            for (var i = 0; i < char.eliminatedWeeks.length; i++) {
                if (parseInt(char.eliminatedWeeks[i]) <= week) {
                    alreadyEliminated = true;
                    break;
                }
            }
        }

        if (alreadyEliminated) {
            alert('This character is already eliminated at or before week ' + week + '.');
            return;
        }

        // Validate week range
        if (week < 1 || week > 52) {
            alert('Week must be between 1 and 52.');
            return;
        }

        // MUTATE
        if (!char.eliminations) char.eliminations = [];
        if (!char.eliminatedWeeks) char.eliminatedWeeks = [];

        char.eliminations.push({
            tournamentId: null,
            week: week,
            reason: reason,
            standalone: true,
            fromMatch: false
        });

        char.eliminatedWeeks.push(week);
        char.eliminatedWeeks.sort(function(a, b) { return a - b; });

        // LOG
        var name = window.getDisplayName(char);
        if (typeof window.logActivity === 'function') {
            window.logActivity('Eliminated ' + name + ' (standalone, week ' + week + '): ' + reason);
        }

        // SAVE
        if (typeof window.saveData === 'function') {
            window.saveData()
                .then(function() {
                    window.CharacterList.render();
                    window.showCharacterForm(charId);
                    if (typeof window.updateDashboardStats === 'function') {
                        window.updateDashboardStats();
                    }
                    alert('Character eliminated successfully!');
                })
                .catch(function(err) {
                    console.error('Failed to add elimination:', err);
                    alert('Failed to add elimination. Please try again.');
                });
        } else {
            window.CharacterList.render();
            window.showCharacterForm(charId);
            if (typeof window.updateDashboardStats === 'function') {
                window.updateDashboardStats();
            }
            alert('Character eliminated successfully!');
        }
    }

    // ============================================================
    // REMOVE STANDALONE ELIMINATION
    // ============================================================

    function removeStandaloneElimination(charId, index) {
        if (!confirm('Remove this standalone elimination?')) return;
        
        var data = window.data || {};
        var char = data.characters.find(function(c) { return String(c.id) === String(charId); });
        if (!char || !char.eliminations) return;

        var elim = char.eliminations[index];
        if (!elim || !elim.standalone) return;

        // MUTATE
        if (char.eliminatedWeeks) {
            var weekIdx = char.eliminatedWeeks.indexOf(parseInt(elim.week));
            if (weekIdx !== -1) {
                char.eliminatedWeeks.splice(weekIdx, 1);
            }
        }
        char.eliminations.splice(index, 1);

        // LOG
        var name = window.getDisplayName(char);
        if (typeof window.logActivity === 'function') {
            window.logActivity('Removed standalone elimination for ' + name + ' (week ' + elim.week + ')');
        }

        // SAVE
        if (typeof window.saveData === 'function') {
            window.saveData()
                .then(function() {
                    window.CharacterList.render();
                    window.showCharacterForm(charId);
                    if (typeof window.updateDashboardStats === 'function') {
                        window.updateDashboardStats();
                    }
                    alert('Standalone elimination removed.');
                })
                .catch(function(err) {
                    console.error('Failed to remove elimination:', err);
                    alert('Failed to remove elimination. Please try again.');
                });
        } else {
            window.CharacterList.render();
            window.showCharacterForm(charId);
            if (typeof window.updateDashboardStats === 'function') {
                window.updateDashboardStats();
            }
            alert('Standalone elimination removed.');
        }
    }

    // ============================================================
    // TOURNAMENT ELIMINATION HELPERS
    // ============================================================

    function markCharacterEliminated(charId, tournamentId, week, reason) {
        var data = window.data || {};
        var char = data.characters.find(function(c) { return String(c.id) === String(charId); });
        if (!char) return;

        var weekNum = parseInt(week) || 1;

        // MUTATE
        if (!char.eliminatedWeeks) char.eliminatedWeeks = [];
        if (char.eliminatedWeeks.indexOf(weekNum) === -1) {
            char.eliminatedWeeks.push(weekNum);
            char.eliminatedWeeks.sort(function(a, b) { return a - b; });
        }

        if (!char.eliminations) char.eliminations = [];
        var alreadyExists = char.eliminations.some(function(e) {
            return !e.standalone && String(e.tournamentId) === String(tournamentId);
        });

        if (!alreadyExists) {
            char.eliminations.push({
                tournamentId: tournamentId,
                week: weekNum,
                reason: reason || 'Eliminated from tournament',
                standalone: false,
                fromMatch: true
            });
        }

        // LOG
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

        // SAVE
        if (typeof window.saveData === 'function') {
            window.saveData()
                .then(function() {
                    window.CharacterList.render();
                    if (typeof window.updateDashboardStats === 'function') {
                        window.updateDashboardStats();
                    }
                })
                .catch(function(err) {
                    console.error('Failed to mark character eliminated:', err);
                });
        }
    }

    function unmarkCharacterEliminated(charId, tournamentId) {
        var data = window.data || {};
        var char = data.characters.find(function(c) { return String(c.id) === String(charId); });
        if (!char) return;

        // MUTATE
        if (char.eliminatedWeeks && tournamentId) {
            // Remove weeks associated with this tournament
            var tourn = data.tournaments.find(function(t) { 
                return String(t.id) === String(tournamentId); 
            });
            if (tourn) {
                var startWeek = parseInt(tourn.startWeek) || 1;
                var idx = char.eliminatedWeeks.indexOf(startWeek);
                if (idx !== -1) {
                    char.eliminatedWeeks.splice(idx, 1);
                }
            }
        }

        if (char.eliminations) {
            char.eliminations = char.eliminations.filter(function(e) {
                return !(String(e.tournamentId) === String(tournamentId) && !e.standalone);
            });
        }

        // LOG
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

        // SAVE
        if (typeof window.saveData === 'function') {
            window.saveData()
                .then(function() {
                    window.CharacterList.render();
                    if (typeof window.updateDashboardStats === 'function') {
                        window.updateDashboardStats();
                    }
                })
                .catch(function(err) {
                    console.error('Failed to unmark character eliminated:', err);
                });
        }
    }

    function isCharacterEliminatedByWeek(char, week) {
        if (!char) return false;
        if (char.deceased) return true;
        
        if (char.eliminatedWeeks && char.eliminatedWeeks.length > 0) {
            var weekNum = parseInt(week) || 1;
            for (var i = 0; i < char.eliminatedWeeks.length; i++) {
                var elimWeek = parseInt(char.eliminatedWeeks[i]);
                if (!isNaN(elimWeek) && elimWeek <= weekNum) {
                    return true;
                }
            }
        }
        return false;
    }

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
        getEliminatedCharacters: getEliminatedCharacters
    };

})();chara
