/**
 * js/modules/characters/characters.js - Character Management
 * Handles character CRUD operations and list rendering
 * Path: js/modules/characters/characters.js
 */

(function() {
    'use strict';

    function renderCharacters(container) {
        // Check if container has content, if not build it
        if (!container.querySelector('#character-form')) {
            container.innerHTML = getCharactersHTML();
        }

        renderCharacterList();
        initCharacterEvents();
        updateClassSuggestion();
        updateMagicClassSuggestion();
        updateMagicPowerDisplay();
    }

    function getCharactersHTML() {
        return `
            <div class="page-header">
                <h2>Character Management</h2>
                <button id="add-character-btn" class="primary">+ Add Character</button>
            </div>
            <div class="filter-section">
                <label for="char-status-filter">Status:</label>
                <select id="char-status-filter">
                    <option value="all">All</option>
                    <option value="trainee">Trainee</option>
                    <option value="rookie">Rookie</option>
                    <option value="junior">Junior</option>
                    <option value="senior">Senior</option>
                    <option value="instructor">Instructor</option>
                    <option value="support">Support</option>
                    <option value="civilian">Civilian</option>
                    <option value="deceased">Deceased</option>
                    <option value="eliminated">Eliminated</option>
                </select>
                <label for="char-name-filter">Name:</label>
                <input type="text" id="char-name-filter" placeholder="Search..." />
                <label class="filter-check">
                    <input type="checkbox" id="hide-deceased" /> Hide Deceased
                </label>
                <label class="filter-check">
                    <input type="checkbox" id="hide-eliminated" /> Hide Eliminated
                </label>
                <button id="clear-char-filter" class="small secondary">Clear</button>
            </div>
            <div id="character-form" class="form-container hidden">
                <h3 id="form-title">Add Character</h3>
                <form id="char-form">
                    <div class="form-grid">
                        <!-- Name Section -->
                        <div class="form-group full-width section-divider">
                            <label class="section-label">Name</label>
                        </div>
                        <div class="form-group">
                            <label>First Name *</label>
                            <input type="text" id="char-firstname" required />
                        </div>
                        <div class="form-group">
                            <label>Middle Name</label>
                            <input type="text" id="char-middlename" />
                        </div>
                        <div class="form-group">
                            <label>Last Name *</label>
                            <input type="text" id="char-lastname" required />
                        </div>
                        <div class="form-group">
                            <label>Nickname</label>
                            <input type="text" id="char-nickname" placeholder="e.g., Ben" />
                        </div>
                        <div class="form-group">
                            <label>Alias</label>
                            <input type="text" id="char-alias" placeholder="e.g., The Shadow" />
                        </div>
                        <div class="form-group full-width">
                            <label>Previous Names (comma separated)</label>
                            <input type="text" id="char-previous-names" placeholder="e.g., John Smith, Jonathan Doe" />
                        </div>
                        <div class="form-group full-width">
                            <label>Display Name Format</label>
                            <select id="char-name-format">
                                <option value="firstlast">First + Last</option>
                                <option value="lastfirst">Last, First</option>
                                <option value="nicklast">Nickname + Last</option>
                                <option value="firstnick">First "Nickname"</option>
                                <option value="alias">Alias</option>
                            </select>
                        </div>
                        <div class="form-group">
                            <label>Year of Birth</label>
                            <input type="number" id="char-birthyear" />
                        </div>
                        <div class="form-group">
                            <label>Gender</label>
                            <input type="text" id="char-gender" placeholder="Male/Female/Other" />
                        </div>
                        <div class="form-group">
                            <label>Eye Color</label>
                            <input type="text" id="char-eyes" placeholder="Blue, Green, Brown..." />
                        </div>
                        <div class="form-group">
                            <label>Hair Color</label>
                            <input type="text" id="char-hair" placeholder="Blonde, Black, Red..." />
                        </div>
                        <div class="form-group">
                            <label>Skin Color/Tone</label>
                            <input type="text" id="char-skin" placeholder="Fair, Olive, Dark..." />
                        </div>
                        <div class="form-group">
                            <label>Height</label>
                            <input type="text" id="char-height" placeholder='e.g., 5'"10"' />
                        </div>
                        <div class="form-group">
                            <label>Weight</label>
                            <input type="text" id="char-weight" placeholder="e.g., 75kg" />
                        </div>
                        <div class="form-group">
                            <label>Build</label>
                            <input type="text" id="char-build" placeholder="Slim, Athletic..." />
                        </div>
                        <div class="form-group full-width">
                            <label>Appearance Notes</label>
                            <textarea id="char-appearance-notes" rows="2" placeholder="Scars, tattoos..."></textarea>
                        </div>
                        <!-- Career Status -->
                        <div class="form-group full-width section-divider">
                            <label class="section-label">Career Status History</label>
                            <div id="career-status-container">
                                <div class="career-status-entry">
                                    <select class="career-status-select">
                                        <option value="">Select status...</option>
                                        <option value="civilian">Civilian</option>
                                        <option value="trainee">Trainee</option>
                                        <option value="rookie">Rookie</option>
                                        <option value="junior">Junior</option>
                                        <option value="senior">Senior</option>
                                        <option value="instructor">Instructor</option>
                                        <option value="support">Support</option>
                                    </select>
                                    <input type="number" class="career-start-year" placeholder="Start Year" />
                                    <input type="number" class="career-end-year" placeholder="End Year" />
                                    <button type="button" class="small danger remove-status">✕</button>
                                </div>
                            </div>
                            <button type="button" id="add-status-btn" class="small">+ Add Status</button>
                            <div id="specialty-field" style="display:none;margin-top:8px;">
                                <label>Specialty/Discipline</label>
                                <input type="text" id="char-specialty" />
                            </div>
                        </div>
                        <!-- Personality -->
                        <div class="form-group full-width section-divider">
                            <label class="section-label">Personality</label>
                            <div class="personality-grid">
                                <div class="form-group"><label>Traits</label><input type="text" id="char-traits" placeholder="Brave, Honest, Curious..." /></div>
                                <div class="form-group"><label>Ideals</label><input type="text" id="char-ideals" placeholder="Justice, Freedom, Truth..." /></div>
                                <div class="form-group"><label>Bonds</label><input type="text" id="char-bonds" placeholder="Family, Guild, Mentor..." /></div>
                                <div class="form-group"><label>Flaws</label><input type="text" id="char-flaws" placeholder="Fear, Pride, Greed..." /></div>
                                <div class="form-group"><label>Alignment</label><input type="text" id="char-alignment" placeholder="Lawful Good, Chaotic Neutral..." /></div>
                                <div class="form-group"><label>Likes</label><input type="text" id="char-likes" placeholder="Music, Books, Combat..." /></div>
                                <div class="form-group"><label>Dislikes</label><input type="text" id="char-dislikes" placeholder="Lies, Injustice, Spiders..." /></div>
                                <div class="form-group"><label>Habits</label><input type="text" id="char-habits" placeholder="Smoking, Pacing, Humming..." /></div>
                                <div class="form-group"><label>Fears</label><input type="text" id="char-fears" placeholder="Heights, Loss, Darkness..." /></div>
                                <div class="form-group"><label>Goals</label><input type="text" id="char-goals" placeholder="Seeking power, Revenge, Peace..." /></div>
                            </div>
                        </div>
                        <!-- Stats -->
                        <div class="form-group full-width section-divider">
                            <label class="section-label">Stats</label>
                            <div class="stat-input-group">
                                <div class="form-group"><label>STR</label><input type="number" id="char-str" min="1" max="30" value="10" /></div>
                                <div class="form-group"><label>DEX</label><input type="number" id="char-dex" min="1" max="30" value="10" /></div>
                                <div class="form-group"><label>CON</label><input type="number" id="char-con" min="1" max="30" value="10" /></div>
                                <div class="form-group"><label>INT</label><input type="number" id="char-int" min="1" max="30" value="10" /></div>
                                <div class="form-group"><label>WIS</label><input type="number" id="char-wis" min="1" max="30" value="10" /></div>
                                <div class="form-group"><label>CHA</label><input type="number" id="char-cha" min="1" max="30" value="10" /></div>
                            </div>
                            <div class="stat-actions">
                                <label class="stat-label">Class:</label>
                                <span id="suggested-class" class="suggested-class empty">—</span>
                                <select id="manual-class-select">
                                    <option value="">Auto-suggest</option>
                                </select>
                                <button type="button" id="random-stats-btn" class="small secondary">Random</button>
                                <button type="button" id="recalculate-class-btn" class="small secondary">Recalc</button>
                            </div>
                        </div>
                        <!-- Magic -->
                        <div class="form-group full-width section-divider">
                            <label class="section-label">Magic</label>
                            <div class="magic-grid">
                                <div class="magic-category-label elemental">Elemental <button type="button" id="random-elemental-btn" class="small secondary">Random</button></div>
                                <div class="magic-item"><label>Earth</label><input type="number" id="magic-earth" min="0" max="10" value="0" /></div>
                                <div class="magic-item"><label>Water</label><input type="number" id="magic-water" min="0" max="10" value="0" /></div>
                                <div class="magic-item"><label>Fire</label><input type="number" id="magic-fire" min="0" max="10" value="0" /></div>
                                <div class="magic-item"><label>Air</label><input type="number" id="magic-air" min="0" max="10" value="0" /></div>
                                <div class="magic-item"><label>Metal</label><input type="number" id="magic-metal" min="0" max="10" value="0" /></div>
                                <div class="magic-item"><label>Wood</label><input type="number" id="magic-wood" min="0" max="10" value="0" /></div>
                                <div class="magic-category-label body">Body <button type="button" id="random-body-btn" class="small secondary">Random</button></div>
                                <div class="magic-item"><label>Blood</label><input type="number" id="magic-blood" min="0" max="10" value="0" /></div>
                                <div class="magic-item"><label>Bone</label><input type="number" id="magic-bone" min="0" max="10" value="0" /></div>
                                <div class="magic-item"><label>Mind</label><input type="number" id="magic-mind" min="0" max="10" value="0" /></div>
                                <div class="magic-item"><label>Morphic</label><input type="number" id="magic-morphic" min="0" max="10" value="0" /></div>
                                <div class="magic-item"><label>Life</label><input type="number" id="magic-life" min="0" max="10" value="0" /></div>
                                <div class="magic-item"><label>Death</label><input type="number" id="magic-death" min="0" max="10" value="0" /></div>
                                <div class="magic-category-label aether">Aether <button type="button" id="random-aether-btn" class="small secondary">Random</button></div>
                                <div class="magic-item"><label>Space</label><input type="number" id="magic-space" min="0" max="10" value="0" /></div>
                                <div class="magic-item"><label>Time</label><input type="number" id="magic-time" min="0" max="10" value="0" /></div>
                                <div class="magic-item"><label>Dimension</label><input type="number" id="magic-dimension" min="0" max="10" value="0" /></div>
                                <div class="magic-item"><label>Void</label><input type="number" id="magic-void" min="0" max="10" value="0" /></div>
                                <div class="magic-item"><label>Reality</label><input type="number" id="magic-reality" min="0" max="10" value="0" /></div>
                                <div class="magic-item"><label>Transference</label><input type="number" id="magic-transference" min="0" max="10" value="0" /></div>
                            </div>
                            <div class="magic-actions">
                                <label class="stat-label">Magic Class:</label>
                                <span id="suggested-magic-class" class="suggested-class empty">—</span>
                                <select id="manual-magic-class-select">
                                    <option value="">Auto-suggest</option>
                                </select>
                                <button type="button" id="recalculate-magic-class-btn" class="small secondary">Recalc</button>
                            </div>
                            <div class="magic-power-display">
                                Magic Power: <span id="magic-power-display-text">◯◯◯◯◯ (0/180)</span>
                            </div>
                        </div>
                        <!-- Special Moves -->
                        <div class="form-group full-width section-divider">
                            <label class="section-label">Special Moves</label>
                            <div class="moves-grid">
                                <div class="moves-column">
                                    <label class="move-label physical">Physical</label>
                                    <div id="physical-moves-list" class="moves-list"><p class="empty-state">No physical moves</p></div>
                                    <div class="move-input-group">
                                        <input type="text" id="physical-move-name" placeholder="Move name" />
                                        <input type="text" id="physical-move-desc" placeholder="Description" />
                                        <button type="button" id="add-physical-move-btn" class="small primary">+ Add</button>
                                    </div>
                                </div>
                                <div class="moves-column">
                                    <label class="move-label magical">Magical</label>
                                    <div id="magical-moves-list" class="moves-list"><p class="empty-state">No magical moves</p></div>
                                    <div class="move-input-group">
                                        <input type="text" id="magical-move-name" placeholder="Move name" />
                                        <input type="text" id="magical-move-desc" placeholder="Description" />
                                        <button type="button" id="add-magical-move-btn" class="small primary">+ Add</button>
                                    </div>
                                </div>
                            </div>
                        </div>
                        <!-- Deceased -->
                        <div class="form-group full-width section-divider">
                            <div class="deceased-toggle">
                                <input type="checkbox" id="char-deceased" />
                                <label for="char-deceased" class="deceased-label">Mark as Deceased</label>
                            </div>
                            <div id="death-fields" class="death-fields">
                                <div class="form-group"><label>Year of Death</label><input type="number" id="char-death-year" placeholder="e.g., 2023" /></div>
                                <div class="form-group"><label>Death Age</label><input type="number" id="char-death-age" min="0" max="150" placeholder="e.g., 45" /></div>
                                <div class="form-group full-width"><label>Cause of Death</label><input type="text" id="char-death-cause" /></div>
                            </div>
                        </div>
                        <!-- Eliminations -->
                        <div class="form-group full-width section-divider">
                            <label class="section-label warning-label">Standalone Elimination</label>
                            <input type="hidden" id="standalone-char-id" />
                            <div class="elimination-controls">
                                <label>Week:</label>
                                <input type="number" id="standalone-elim-week" min="1" max="52" value="1" />
                                <label>Reason:</label>
                                <input type="text" id="standalone-elim-reason" placeholder="e.g., Dropped out" />
                                <button type="button" id="add-standalone-elim-btn" class="small warning-btn">Apply</button>
                            </div>
                            <div class="elimination-list">
                                <label>Existing:</label>
                                <div id="standalone-eliminations-container"><p class="empty-state">None</p></div>
                            </div>
                        </div>
                        <!-- Tournament Eliminations -->
                        <div class="form-group full-width section-divider">
                            <label class="section-label info-label">Tournament Eliminations</label>
                            <div id="tournament-eliminations-view"><p class="empty-state">None</p></div>
                        </div>
                        <div class="form-group full-width">
                            <label>Notes</label>
                            <textarea id="char-notes" rows="3" placeholder="Background, motivations..."></textarea>
                        </div>
                    </div>
                    <div class="form-actions">
                        <button type="button" id="cancel-char-btn" class="secondary">Cancel</button>
                        <button type="submit" id="save-char-btn" class="primary">Save Character</button>
                    </div>
                </form>
            </div>
            <div id="character-list">
                <div class="list-header char-header">
                    <span>Name</span>
                    <span>Age</span>
                    <span>Status</span>
                    <span>Class</span>
                    <span>Magic</span>
                    <span>Power</span>
                    <span>Actions</span>
                </div>
                <div id="characters-container">
                    <p class="empty-state">No characters created yet.</p>
                </div>
            </div>
        `;
    }

    function renderCharacterList() {
        var container = document.getElementById('characters-container');
        if (!container) return;

        var data = window.data || {};
        if (!data.characters || data.characters.length === 0) {
            container.innerHTML = '<p class="empty-state">No characters created yet. Add your first character!</p>';
            return;
        }

        var statusFilter = document.getElementById('char-status-filter') ? document.getElementById('char-status-filter').value : 'all';
        var nameFilter = document.getElementById('char-name-filter') ? document.getElementById('char-name-filter').value.toLowerCase() : '';
        var hideDeceased = document.getElementById('hide-deceased') ? document.getElementById('hide-deceased').checked : false;
        var hideEliminated = document.getElementById('hide-eliminated') ? document.getElementById('hide-eliminated').checked : false;

        var sortedChars = data.characters.slice().sort(function(a, b) {
            var aDeceased = a.deceased || false;
            var bDeceased = b.deceased || false;
            var aEliminated = (a.eliminations && a.eliminations.length > 0) || false;
            var bEliminated = (b.eliminations && b.eliminations.length > 0) || false;

            if (aDeceased && !bDeceased) return 1;
            if (!aDeceased && bDeceased) return -1;
            if (aEliminated && !bEliminated) return 1;
            if (!aEliminated && bEliminated) return -1;
            return (a.firstName || '').toLowerCase().localeCompare((b.firstName || '').toLowerCase());
        });

        var filteredChars = sortedChars.filter(function(char) {
            if (hideDeceased && char.deceased) return false;
            if (hideEliminated && char.eliminations && char.eliminations.length > 0) return false;

            if (nameFilter) {
                var displayName = window.getDisplayName(char).toLowerCase();
                var fullName = window.getFullName(char).toLowerCase();
                if (displayName.indexOf(nameFilter) === -1 && fullName.indexOf(nameFilter) === -1) {
                    return false;
                }
            }
            if (statusFilter !== 'all') {
                if (statusFilter === 'deceased') {
                    if (!char.deceased) return false;
                } else if (statusFilter === 'eliminated') {
                    var hasElimination = char.eliminations && char.eliminations.length > 0;
                    if (!hasElimination) return false;
                } else {
                    var status = window.getCurrentStatus(char).toLowerCase();
                    if (status !== statusFilter && !status.startsWith(statusFilter + ' ')) {
                        return false;
                    }
                }
            }
            return true;
        });

        if (filteredChars.length === 0) {
            container.innerHTML = '<p class="empty-state">No characters match the current filters.</p>';
            return;
        }

        var html = '';
        var classes = window.CLASS_DEFINITIONS || [];

        filteredChars.forEach(function(char) {
            var displayName = window.getDisplayName(char);
            var age = window.calculateAge(char);
            var ageDisplay = age !== null ? age + ' yrs' : '-';
            var status = window.getCurrentStatus(char);
            var isDead = char.deceased || false;
            var deadClass = isDead ? ' deceased' : '';
            var deadBadge = isDead ? ' <span class="deceased-badge">Deceased</span>' : '';

            var stats = window.getCharacterStats(char);
            var suggestedClass = window.suggestClass(stats);
            var classDisplay = suggestedClass ? suggestedClass.icon + ' ' + suggestedClass.label : '\u2014';
            var powerDisplay = window.getPowerLevelDisplay(char);
            var powerLevel = window.getPowerLevelFromDisplay(powerDisplay);
            var powerColor = window.getPowerLevelColor(powerLevel);

            var magicClass = window.suggestMagicClass(char);
            var magicClassDisplay = magicClass ? magicClass.name : '\u2014';
            var magicPowerDisplay = window.getMagicPowerDisplay(char);
            var magicPowerLevel = window.getPowerLevelFromDisplay(magicPowerDisplay);
            var magicPowerColor = window.getPowerLevelColor(magicPowerLevel);

            var hasTournamentElim = false;
            var hasStandalone = false;
            var latestElimWeek = null;
            var tournamentNames = [];

            if (char.eliminations && char.eliminations.length > 0) {
                char.eliminations.forEach(function(elim) {
                    if (elim.standalone) {
                        hasStandalone = true;
                    } else {
                        hasTournamentElim = true;
                        if (elim.tournamentId && window.data && window.data.tournaments) {
                            var tourn = window.data.tournaments.find(function(t) { return String(t.id) === String(elim.tournamentId); });
                            if (tourn) {
                                tournamentNames.push(tourn.name);
                            }
                        }
                    }
                    var week = parseInt(elim.week);
                    if (!isNaN(week) && (latestElimWeek === null || week > latestElimWeek)) {
                        latestElimWeek = week;
                    }
                });
            }

            var elimBadges = '';
            if (hasStandalone) {
                elimBadges += ' <span class="eliminated-badge">Standalone Eliminated</span>';
            }
            if (hasTournamentElim) {
                var tournDisplay = tournamentNames.length > 0 ? ' (' + tournamentNames.slice(0, 2).join(', ') + (tournamentNames.length > 2 ? ' +' + (tournamentNames.length - 2) : '') + ')' : '';
                elimBadges += ' <span class="eliminated-badge">Tournament Eliminated' + tournDisplay + '</span>';
            }
            var elimWeekBadge = latestElimWeek !== null ? ' <span class="warning-badge">Wk ' + latestElimWeek + '</span>' : '';

            html += '<div class="list-item char-item' + deadClass + '" data-id="' + char.id + '">' +
                '<span><strong>' + displayName + '</strong>' + deadBadge + elimBadges + elimWeekBadge + '</span>' +
                '<span>' + ageDisplay + '</span>' +
                '<span>' + status + '</span>' +
                '<span style="font-size:0.75rem;color:var(--accent);">' + classDisplay + '</span>' +
                '<span style="font-size:0.75rem;color:var(--info);">' + magicClassDisplay + '</span>' +
                '<span style="font-size:0.85rem;color:' + powerColor + ';letter-spacing:1px;">' + powerDisplay + '</span>' +
                '<span class="actions">' +
                    '<button class="small view-character" data-id="' + char.id + '">View</button>' +
                    '<button class="small edit-character" data-id="' + char.id + '">Edit</button>' +
                    '<button class="small danger delete-character" data-id="' + char.id + '">Delete</button>' +
                '</span>' +
            '</div>';
        });

        container.innerHTML = html;

        container.querySelectorAll('.view-character').forEach(function(btn) {
            btn.addEventListener('click', function(e) {
                e.stopPropagation();
                if (typeof window.openCharacterDetail === 'function') {
                    window.openCharacterDetail(this.dataset.id);
                }
            });
        });

        container.querySelectorAll('.edit-character').forEach(function(btn) {
            btn.addEventListener('click', function(e) {
                e.stopPropagation();
                showCharacterForm(this.dataset.id);
            });
        });

        container.querySelectorAll('.delete-character').forEach(function(btn) {
            btn.addEventListener('click', function(e) {
                e.stopPropagation();
                deleteCharacter(this.dataset.id);
            });
        });
    }

    function initCharacterEvents() {
        var addBtn = document.getElementById('add-character-btn');
        if (addBtn) {
            addBtn.addEventListener('click', function() { showCharacterForm(); });
        }

        var cancelBtn = document.getElementById('cancel-char-btn');
        if (cancelBtn) {
            cancelBtn.addEventListener('click', hideCharacterForm);
        }

        var form = document.getElementById('char-form');
        if (form) {
            form.addEventListener('submit', saveCharacter);
        }

        var addStatusBtn = document.getElementById('add-status-btn');
        if (addStatusBtn) {
            addStatusBtn.addEventListener('click', function() {
                var container = document.getElementById('career-status-container');
                addCareerStatusEntry(container);
            });
        }

        var addStandaloneElimBtn = document.getElementById('add-standalone-elim-btn');
        if (addStandaloneElimBtn) {
            addStandaloneElimBtn.addEventListener('click', function() {
                addStandaloneElimination();
            });
        }

        var deceasedCheck = document.getElementById('char-deceased');
        if (deceasedCheck) {
            deceasedCheck.addEventListener('change', function() {
                var deathFields = document.getElementById('death-fields');
                if (deathFields) {
                    deathFields.style.display = this.checked ? 'block' : 'none';
                }
            });
        }

        var statusFilter = document.getElementById('char-status-filter');
        if (statusFilter) {
            statusFilter.addEventListener('change', renderCharacterList);
        }

        var nameFilter = document.getElementById('char-name-filter');
        if (nameFilter) {
            nameFilter.addEventListener('input', renderCharacterList);
        }

        var hideDeceased = document.getElementById('hide-deceased');
        if (hideDeceased) {
            hideDeceased.addEventListener('change', renderCharacterList);
        }

        var hideEliminated = document.getElementById('hide-eliminated');
        if (hideEliminated) {
            hideEliminated.addEventListener('change', renderCharacterList);
        }

        var clearFilter = document.getElementById('clear-char-filter');
        if (clearFilter) {
            clearFilter.addEventListener('click', function() {
                var statusFilter = document.getElementById('char-status-filter');
                var nameFilter = document.getElementById('char-name-filter');
                var hideDeceased = document.getElementById('hide-deceased');
                var hideEliminated = document.getElementById('hide-eliminated');
                if (statusFilter) statusFilter.value = 'all';
                if (nameFilter) nameFilter.value = '';
                if (hideDeceased) hideDeceased.checked = false;
                if (hideEliminated) hideEliminated.checked = false;
                renderCharacterList();
            });
        }

        // Stats events
        var statInputs = ['char-str', 'char-dex', 'char-con', 'char-int', 'char-wis', 'char-cha'];
        statInputs.forEach(function(id) {
            var el = document.getElementById(id);
            if (el) {
                el.addEventListener('input', function() {
                    var val = parseInt(this.value);
                    if (isNaN(val)) val = 10;
                    if (val < 1) val = 1;
                    if (val > 30) val = 30;
                    this.value = val;
                    updateClassSuggestion();
                });
            }
        });

        var classSelect = document.getElementById('manual-class-select');
        if (classSelect) {
            var classes = window.CLASS_DEFINITIONS || [];
            classSelect.innerHTML = '<option value="">Auto-suggest</option>';
            classes.forEach(function(cls) {
                var option = document.createElement('option');
                option.value = cls.id;
                option.textContent = cls.icon + ' ' + cls.label;
                classSelect.appendChild(option);
            });
            classSelect.addEventListener('change', function() {
                var display = document.getElementById('suggested-class');
                if (this.value) {
                    var selected = classes.find(function(c) { return c.id === this.value; });
                    if (selected) {
                        display.textContent = selected.icon + ' ' + selected.label;
                        display.style.color = 'var(--accent)';
                        display.style.background = 'var(--accent-soft)';
                        display.style.borderColor = 'var(--accent)';
                    }
                } else {
                    updateClassSuggestion();
                }
            });
        }

        var recalcBtn = document.getElementById('recalculate-class-btn');
        if (recalcBtn) {
            recalcBtn.addEventListener('click', updateClassSuggestion);
        }

        var randomBtn = document.getElementById('random-stats-btn');
        if (randomBtn) {
            randomBtn.addEventListener('click', function() {
                var stats = window.generateRandomStats();
                document.getElementById('char-str').value = stats.str;
                document.getElementById('char-dex').value = stats.dex;
                document.getElementById('char-con').value = stats.con;
                document.getElementById('char-int').value = stats.int;
                document.getElementById('char-wis').value = stats.wis;
                document.getElementById('char-cha').value = stats.cha;
                updateClassSuggestion();
            });
        }

        // Magic events
        var magicInputs = ['magic-earth', 'magic-water', 'magic-fire', 'magic-air', 'magic-metal', 'magic-wood',
            'magic-blood', 'magic-bone', 'magic-mind', 'magic-morphic', 'magic-life', 'magic-death',
            'magic-space', 'magic-time', 'magic-dimension', 'magic-void', 'magic-reality', 'magic-transference'
        ];
        magicInputs.forEach(function(id) {
            var el = document.getElementById(id);
            if (el) {
                el.addEventListener('input', function() {
                    var val = parseInt(this.value);
                    if (isNaN(val)) val = 0;
                    if (val < 0) val = 0;
                    if (val > 10) val = 10;
                    this.value = val;
                    updateMagicClassSuggestion();
                    updateMagicPowerDisplay();
                });
            }
        });

        var magicClassSelect = document.getElementById('manual-magic-class-select');
        if (magicClassSelect) {
            var magicOptions = [
                { value: '', label: 'Auto-suggest' },
                { value: 'elementalist', label: 'Elementalist' },
                { value: 'body_mage', label: 'Body Mage' },
                { value: 'aether_mage', label: 'Aether Mage' }
            ];
            var classMap = {
                elemental: { earth: 'Geomancer', water: 'Hydromancer', fire: 'Pyromancer',
                    air: 'Aeromancer', metal: 'Ferromancer', wood: 'Dendromancer' },
                body: { blood: 'Hemomancer', bone: 'Osteomancer', mind: 'Psychomancer',
                    morphic: 'Morphomancer', life: 'Vitalmancer', death: 'Necromancer' },
                aether: { space: 'Spatiomancer', time: 'Chronomancer', dimension: 'Dimensionist',
                    void: 'Voidmancer', reality: 'Reality Weaver', transference: 'Transference Mage' }
            };
            for (var cat in classMap) {
                for (var type in classMap[cat]) {
                    magicOptions.push({ value: type, label: classMap[cat][type] });
                }
            }
            magicClassSelect.innerHTML = '';
            magicOptions.forEach(function(opt) {
                var option = document.createElement('option');
                option.value = opt.value;
                option.textContent = opt.label;
                magicClassSelect.appendChild(option);
            });
            magicClassSelect.addEventListener('change', function() {
                var display = document.getElementById('suggested-magic-class');
                if (this.value) {
                    var selected = magicOptions.find(function(o) { return o.value === this.value; });
                    if (selected) {
                        display.textContent = selected.label;
                        display.style.color = 'var(--info)';
                        display.style.background = 'var(--info-soft)';
                        display.style.borderColor = 'var(--info)';
                    }
                } else {
                    updateMagicClassSuggestion();
                }
            });
        }

        var recalcMagicBtn = document.getElementById('recalculate-magic-class-btn');
        if (recalcMagicBtn) {
            recalcMagicBtn.addEventListener('click', function() {
                updateMagicClassSuggestion();
                updateMagicPowerDisplay();
            });
        }

        var randomElementalBtn = document.getElementById('random-elemental-btn');
        if (randomElementalBtn) {
            randomElementalBtn.addEventListener('click', function() {
                var magic = generateRandomMagicCategory('elemental');
                var types = ['earth', 'water', 'fire', 'air', 'metal', 'wood'];
                types.forEach(function(key) {
                    var input = document.getElementById('magic-' + key);
                    if (input && magic[key] !== undefined) {
                        input.value = magic[key];
                    }
                });
                updateMagicClassSuggestion();
                updateMagicPowerDisplay();
            });
        }

        var randomBodyBtn = document.getElementById('random-body-btn');
        if (randomBodyBtn) {
            randomBodyBtn.addEventListener('click', function() {
                var magic = generateRandomMagicCategory('body');
                var types = ['blood', 'bone', 'mind', 'morphic', 'life', 'death'];
                types.forEach(function(key) {
                    var input = document.getElementById('magic-' + key);
                    if (input && magic[key] !== undefined) {
                        input.value = magic[key];
                    }
                });
                updateMagicClassSuggestion();
                updateMagicPowerDisplay();
            });
        }

        var randomAetherBtn = document.getElementById('random-aether-btn');
        if (randomAetherBtn) {
            randomAetherBtn.addEventListener('click', function() {
                var magic = generateRandomMagicCategory('aether');
                var types = ['space', 'time', 'dimension', 'void', 'reality', 'transference'];
                types.forEach(function(key) {
                    var input = document.getElementById('magic-' + key);
                    if (input && magic[key] !== undefined) {
                        input.value = magic[key];
                    }
                });
                updateMagicClassSuggestion();
                updateMagicPowerDisplay();
            });
        }

        // Special moves events
        var addPhysicalBtn = document.getElementById('add-physical-move-btn');
        if (addPhysicalBtn) {
            addPhysicalBtn.addEventListener('click', function() {
                var form = document.getElementById('char-form');
                var editId = form ? form.dataset.editId : null;
                if (!editId) {
                    alert('Please save the character first before adding special moves.');
                    return;
                }
                var char = window.getCharacterById(editId);
                if (!char) return;
                var name = document.getElementById('physical-move-name').value.trim();
                var desc = document.getElementById('physical-move-desc').value.trim();
                if (!name) { alert('Please enter a move name.'); return; }
                addSpecialMove(char, 'physical', name, desc);
                var moves = window.getSpecialMoves(char);
                renderSpecialMoves('physical-moves-list', moves.physical, 'physical');
                document.getElementById('physical-move-name').value = '';
                document.getElementById('physical-move-desc').value = '';
                if (typeof window.saveData === 'function') {
                    window.saveData().catch(function(err) { /* ignore */ });
                }
            });
        }

        var addMagicalBtn = document.getElementById('add-magical-move-btn');
        if (addMagicalBtn) {
            addMagicalBtn.addEventListener('click', function() {
                var form = document.getElementById('char-form');
                var editId = form ? form.dataset.editId : null;
                if (!editId) {
                    alert('Please save the character first before adding special moves.');
                    return;
                }
                var char = window.getCharacterById(editId);
                if (!char) return;
                var name = document.getElementById('magical-move-name').value.trim();
                var desc = document.getElementById('magical-move-desc').value.trim();
                if (!name) { alert('Please enter a move name.'); return; }
                addSpecialMove(char, 'magical', name, desc);
                var moves = window.getSpecialMoves(char);
                renderSpecialMoves('magical-moves-list', moves.magical, 'magical');
                document.getElementById('magical-move-name').value = '';
                document.getElementById('magical-move-desc').value = '';
                if (typeof window.saveData === 'function') {
                    window.saveData().catch(function(err) { /* ignore */ });
                }
            });
        }

        // Populate class select
        populateClassSelect();
    }

    function generateRandomMagicCategory(category) {
        var types = {
            elemental: ['earth', 'water', 'fire', 'air', 'metal', 'wood'],
            body: ['blood', 'bone', 'mind', 'morphic', 'life', 'death'],
            aether: ['space', 'time', 'dimension', 'void', 'reality', 'transference']
        };

        var magic = {};
        var categoryTypes = types[category] || [];
        categoryTypes.forEach(function(key) {
            var roll = Math.random();
            if (roll < 0.3) {
                magic[key] = 0;
            } else if (roll < 0.6) {
                magic[key] = Math.floor(Math.random() * 4) + 1;
            } else if (roll < 0.85) {
                magic[key] = Math.floor(Math.random() * 4) + 5;
            } else {
                magic[key] = Math.floor(Math.random() * 3) + 8;
            }
        });
        return magic;
    }

    function populateClassSelect() {
        var select = document.getElementById('manual-class-select');
        if (!select) return;
        var classes = window.CLASS_DEFINITIONS || [];
        select.innerHTML = '<option value="">Auto-suggest</option>';
        classes.forEach(function(cls) {
            var option = document.createElement('option');
            option.value = cls.id;
            option.textContent = cls.icon + ' ' + cls.label;
            select.appendChild(option);
        });
    }

    function updateClassSuggestion() {
        var str = parseInt(document.getElementById('char-str') ? document.getElementById('char-str').value : 10) || 10;
        var dex = parseInt(document.getElementById('char-dex') ? document.getElementById('char-dex').value : 10) || 10;
        var con = parseInt(document.getElementById('char-con') ? document.getElementById('char-con').value : 10) || 10;
        var int = parseInt(document.getElementById('char-int') ? document.getElementById('char-int').value : 10) || 10;
        var wis = parseInt(document.getElementById('char-wis') ? document.getElementById('char-wis').value : 10) || 10;
        var cha = parseInt(document.getElementById('char-cha') ? document.getElementById('char-cha').value : 10) || 10;

        var stats = { str: str, dex: dex, con: con, int: int, wis: wis, cha: cha };
        var suggested = window.suggestClass(stats);
        var display = document.getElementById('suggested-class');

        if (display) {
            if (suggested) {
                display.textContent = suggested.icon + ' ' + suggested.label;
                display.style.color = 'var(--accent)';
                display.style.background = 'var(--accent-soft)';
                display.style.borderColor = 'var(--accent)';
            } else {
                display.textContent = '\u2014';
                display.style.color = 'var(--text-dim)';
                display.style.background = 'transparent';
                display.style.borderColor = 'var(--border)';
            }
        }
    }

    function updateMagicClassSuggestion() {
        var magic = {};
        var types = ['earth', 'water', 'fire', 'air', 'metal', 'wood',
            'blood', 'bone', 'mind', 'morphic', 'life', 'death',
            'space', 'time', 'dimension', 'void', 'reality', 'transference'
        ];
        types.forEach(function(key) {
            var input = document.getElementById('magic-' + key);
            magic[key] = input ? parseInt(input.value) || 0 : 0;
        });

        var tempChar = { magic: magic };
        var suggested = window.suggestMagicClass(tempChar);
        var display = document.getElementById('suggested-magic-class');

        if (display) {
            if (suggested) {
                display.textContent = suggested.name;
                display.style.color = 'var(--info)';
                display.style.background = 'var(--info-soft)';
                display.style.borderColor = 'var(--info)';
            } else {
                display.textContent = '\u2014';
                display.style.color = 'var(--text-dim)';
                display.style.background = 'transparent';
                display.style.borderColor = 'var(--border)';
            }
        }
    }

    function updateMagicPowerDisplay() {
        var types = ['earth', 'water', 'fire', 'air', 'metal', 'wood',
            'blood', 'bone', 'mind', 'morphic', 'life', 'death',
            'space', 'time', 'dimension', 'void', 'reality', 'transference'
        ];
        var total = 0;
        types.forEach(function(key) {
            var input = document.getElementById('magic-' + key);
            var val = input ? parseInt(input.value) || 0 : 0;
            total += val;
        });

        var maxPower = 180;
        var percentage = Math.min(100, Math.round((total / maxPower) * 100));
        var level = Math.floor(percentage / 20);
        if (level > 4) level = 4;
        if (level < 0) level = 0;
        var filled = '\u25CF';
        var empty = '\u25CB';
        var display = '';
        for (var i = 0; i < 5; i++) {
            display += (i <= level) ? filled : empty;
        }

        var el = document.getElementById('magic-power-display-text');
        if (el) {
            el.textContent = display + ' (' + total + '/' + maxPower + ')';
        }
    }

    function renderSpecialMoves(containerId, moves, type) {
        var container = document.getElementById(containerId);
        if (!container) return;

        if (!moves || moves.length === 0) {
            container.innerHTML = '<p class="empty-state" style="padding:4px;font-size:0.75rem;">No special moves</p>';
            return;
        }

        var html = '';
        var color = type === 'physical' ? 'var(--accent)' : 'var(--info)';
        moves.forEach(function(move, index) {
            html += '<div class="special-move-entry" style="border-left-color:' + color + ';">';
            html += '<div><span class="move-name">' + move.name + '</span> <span class="move-desc">' + (move.description || '') + '</span></div>';
            html += '<button class="remove-special-move small" style="background:none;border:none;color:var(--danger);cursor:pointer;font-size:0.6rem;padding:0 4px;" data-type="' + type + '" data-index="' + index + '">✕</button>';
            html += '</div>';
        });
        container.innerHTML = html;

        container.querySelectorAll('.remove-special-move').forEach(function(btn) {
            btn.addEventListener('click', function() {
                var form = document.getElementById('char-form');
                var editId = form ? form.dataset.editId : null;
                if (!editId) {
                    alert('Please save the character first.');
                    return;
                }
                var char = window.getCharacterById(editId);
                if (!char) return;
                var type = this.dataset.type;
                var index = parseInt(this.dataset.index);
                removeSpecialMove(char, type, index);
                var moves = window.getSpecialMoves(char);
                renderSpecialMoves('physical-moves-list', moves.physical, 'physical');
                renderSpecialMoves('magical-moves-list', moves.magical, 'magical');
                if (typeof window.saveData === 'function') {
                    window.saveData().catch(function(err) { /* ignore */ });
                }
            });
        });
    }

    function addSpecialMove(char, type, name, description) {
        if (!char) return false;
        var moves = window.getSpecialMoves(char);
        if (!moves[type]) moves[type] = [];
        moves[type].push({
            id: window.generateId('move'),
            name: name || 'Unnamed Move',
            description: description || ''
        });
        return true;
    }

    function removeSpecialMove(char, type, index) {
        if (!char) return false;
        var moves = window.getSpecialMoves(char);
        if (!moves[type] || !moves[type][index]) return false;
        moves[type].splice(index, 1);
        return true;
    }

    function showCharacterForm(editId) {
        var form = document.getElementById('character-form');
        var title = document.getElementById('form-title');
        var formElement = document.getElementById('char-form');
        form.classList.remove('hidden');

        var targetElement = form;
        if (editId) {
            var listItem = document.querySelector('.char-item[data-id="' + editId + '"]');
            if (listItem) {
                targetElement = listItem;
            }
        }
        targetElement.scrollIntoView({ behavior: 'smooth', block: 'start' });

        var data = window.data || {};

        if (editId) {
            title.textContent = 'Edit Character';
            var char = data.characters.find(function(c) { return String(c.id) === String(editId); });
            if (char) {
                document.getElementById('char-firstname').value = char.firstName || '';
                document.getElementById('char-middlename').value = char.middleName || '';
                document.getElementById('char-lastname').value = char.lastName || '';
                document.getElementById('char-nickname').value = char.nickname || '';
                document.getElementById('char-alias').value = char.alias || '';
                document.getElementById('char-previous-names').value = (char.previousNames || []).join(', ');
                document.getElementById('char-name-format').value = char.nameFormat || 'firstlast';
                document.getElementById('char-birthyear').value = char.birthYear || '';
                document.getElementById('char-gender').value = char.gender || '';
                document.getElementById('char-eyes').value = char.eyes || '';
                document.getElementById('char-hair').value = char.hair || '';
                document.getElementById('char-skin').value = char.skin || '';
                document.getElementById('char-height').value = char.height || '';
                document.getElementById('char-weight').value = char.weight || '';
                document.getElementById('char-build').value = char.build || '';
                document.getElementById('char-appearance-notes').value = char.appearanceNotes || '';
                document.getElementById('char-notes').value = char.notes || '';
                document.getElementById('char-specialty').value = char.specialty || '';
                document.getElementById('char-deceased').checked = char.deceased || false;
                document.getElementById('char-death-year').value = char.deathYear || '';
                document.getElementById('char-death-cause').value = char.deathCause || '';
                document.getElementById('char-death-age').value = char.deathAge || '';
                document.getElementById('char-traits').value = char.personality ? char.personality.traits || '' : '';
                document.getElementById('char-ideals').value = char.personality ? char.personality.ideals || '' : '';
                document.getElementById('char-bonds').value = char.personality ? char.personality.bonds || '' : '';
                document.getElementById('char-flaws').value = char.personality ? char.personality.flaws || '' : '';
                document.getElementById('char-alignment').value = char.personality ? char.personality.alignment || '' : '';
                document.getElementById('char-likes').value = char.personality ? char.personality.likes || '' : '';
                document.getElementById('char-dislikes').value = char.personality ? char.personality.dislikes || '' : '';
                document.getElementById('char-habits').value = char.personality ? char.personality.habits || '' : '';
                document.getElementById('char-fears').value = char.personality ? char.personality.fears || '' : '';
                document.getElementById('char-goals').value = char.personality ? char.personality.goals || '' : '';

                var deathFields = document.getElementById('death-fields');
                if (deathFields) {
                    deathFields.style.display = char.deceased ? 'block' : 'none';
                }

                var stats = window.getCharacterStats(char);
                document.getElementById('char-str').value = stats.str || 10;
                document.getElementById('char-dex').value = stats.dex || 10;
                document.getElementById('char-con').value = stats.con || 10;
                document.getElementById('char-int').value = stats.int || 10;
                document.getElementById('char-wis').value = stats.wis || 10;
                document.getElementById('char-cha').value = stats.cha || 10;
                updateClassSuggestion();

                var magic = window.getCharacterMagic(char);
                for (var key in magic) {
                    var input = document.getElementById('magic-' + key);
                    if (input) {
                        input.value = magic[key] || 0;
                    }
                }
                updateMagicClassSuggestion();
                updateMagicPowerDisplay();

                var moves = window.getSpecialMoves(char);
                renderSpecialMoves('physical-moves-list', moves.physical, 'physical');
                renderSpecialMoves('magical-moves-list', moves.magical, 'magical');

                var container = document.getElementById('career-status-container');
                container.innerHTML = '';
                if (char.careerStatus && char.careerStatus.length > 0) {
                    char.careerStatus.forEach(function(status) {
                        addCareerStatusEntry(container, status.status, status.startYear, status.endYear);
                    });
                } else {
                    addCareerStatusEntry(container);
                }

                renderStandaloneEliminations(char);
                renderTournamentEliminations(char);

                formElement.dataset.editId = editId;
                document.getElementById('standalone-char-id').value = editId;
            }
        } else {
            title.textContent = 'Add Character';
            formElement.reset();
            delete formElement.dataset.editId;
            var deathFields = document.getElementById('death-fields');
            if (deathFields) deathFields.style.display = 'none';

            document.getElementById('char-str').value = 10;
            document.getElementById('char-dex').value = 10;
            document.getElementById('char-con').value = 10;
            document.getElementById('char-int').value = 10;
            document.getElementById('char-wis').value = 10;
            document.getElementById('char-cha').value = 10;
            updateClassSuggestion();

            var defaultMagic = window.getDefaultMagicProficiencies();
            for (var key in defaultMagic) {
                var input = document.getElementById('magic-' + key);
                if (input) {
                    input.value = 0;
                }
            }
            updateMagicClassSuggestion();
            updateMagicPowerDisplay();

            var container = document.getElementById('career-status-container');
            container.innerHTML = '';
            addCareerStatusEntry(container);

            document.getElementById('char-specialty').value = '';
            var specialtyField = document.getElementById('specialty-field');
            if (specialtyField) specialtyField.style.display = 'none';

            var standaloneContainer = document.getElementById('standalone-eliminations-container');
            if (standaloneContainer) standaloneContainer.innerHTML = '<p class="empty-state" style="padding:8px;font-size:0.8rem;">No standalone eliminations recorded.</p>';
            document.getElementById('standalone-char-id').value = '';
            document.getElementById('standalone-elim-week').value = 1;
            document.getElementById('standalone-elim-reason').value = '';

            var tournContainer = document.getElementById('tournament-eliminations-view');
            if (tournContainer) {
                tournContainer.innerHTML = '<p class="empty-state" style="padding:6px;font-size:0.75rem;">No tournament eliminations recorded.</p>';
            }
        }
        setTimeout(function() {
            var firstName = document.getElementById('char-firstname');
            if (firstName) firstName.focus();
        }, 300);
    }

    function hideCharacterForm() {
        document.getElementById('character-form').classList.add('hidden');
    }

    function addCareerStatusEntry(container, status, startYear, endYear) {
        var entry = document.createElement('div');
        entry.className = 'career-status-entry';
        entry.innerHTML = `
            <select class="career-status-select">
                <option value="">Select status...</option>
                <option value="civilian" ${status === 'civilian' ? 'selected' : ''}>Civilian</option>
                <option value="trainee" ${status === 'trainee' ? 'selected' : ''}>Trainee</option>
                <option value="rookie" ${status === 'rookie' ? 'selected' : ''}>Rookie</option>
                <option value="junior" ${status === 'junior' ? 'selected' : ''}>Junior</option>
                <option value="senior" ${status === 'senior' ? 'selected' : ''}>Senior</option>
                <option value="instructor" ${status === 'instructor' ? 'selected' : ''}>Instructor</option>
                <option value="support" ${status === 'support' ? 'selected' : ''}>Support</option>
            </select>
            <input type="number" class="career-start-year" placeholder="Start Year" value="${startYear || ''}">
            <input type="number" class="career-end-year" placeholder="End Year (or leave blank)" value="${endYear || ''}">
            <button type="button" class="small danger remove-status">✕</button>
        `;
        container.appendChild(entry);
        var select = entry.querySelector('.career-status-select');
        var specialtyField = document.getElementById('specialty-field');
        select.onchange = function() {
            if (specialtyField) {
                specialtyField.style.display = (this.value === 'instructor' || this.value === 'support') ? 'block' : 'none';
            }
        };
        entry.querySelector('.remove-status').onclick = function() {
            if (container.children.length > 1) {
                entry.remove();
            } else {
                alert('You need at least one status entry.');
            }
        };
    }

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
                var tourn = data.tournaments.find(function(t) { return String(t.id) === String(elim.tournamentId); });
                if (tourn) tournName = tourn.name;
            }
            html += '<div style="display:flex;justify-content:space-between;align-items:center;padding:4px 8px;background:var(--info-soft);border-radius:4px;margin-bottom:2px;border-left:3px solid var(--info);">';
            html += '<span style="font-size:0.75rem;"><strong>' + tournName + '</strong> - Week ' + elim.week + (elim.reason ? ' (' + elim.reason + ')' : '') + '</span>';
            html += '</div>';
        });
        container.innerHTML = html;
    }

    function renderStandaloneEliminations(char) {
        var container = document.getElementById('standalone-eliminations-container');
        if (!container) return;

        var standaloneElims = [];
        if (char.eliminations) {
            standaloneElims = char.eliminations.filter(function(e) { return e.standalone; });
        }

        if (standaloneElims.length === 0) {
            container.innerHTML = '<p class="empty-state" style="padding:8px;font-size:0.8rem;">No standalone eliminations recorded.</p>';
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
                removeStandaloneElimination(char.id, parseInt(this.dataset.index));
            });
        });
    }

    function addStandaloneElimination() {
        var charId = document.getElementById('standalone-char-id') ? document.getElementById('standalone-char-id').value : '';
        if (!charId) {
            alert('Please select a character first.');
            return;
        }

        var week = parseInt(document.getElementById('standalone-elim-week') ? document.getElementById('standalone-elim-week').value : 1) || 1;
        var reason = document.getElementById('standalone-elim-reason') ? document.getElementById('standalone-elim-reason').value || 'Dropped out' : 'Dropped out';

        var data = window.data || {};
        var char = data.characters.find(function(c) { return String(c.id) === String(charId); });
        if (!char) {
            alert('Character not found.');
            return;
        }

        var alreadyEliminated = false;
        if (char.eliminatedWeeks) {
            char.eliminatedWeeks.forEach(function(w) {
                if (parseInt(w) <= week) {
                    alreadyEliminated = true;
                }
            });
        }

        if (alreadyEliminated) {
            alert('This character is already eliminated at or before week ' + week + '.');
            return;
        }

        if (!char.eliminations) char.eliminations = [];
        if (!char.eliminatedWeeks) char.eliminatedWeeks = [];

        char.eliminations.push({
            tournamentId: null,
            week: week,
            reason: reason,
            standalone: true
        });

        char.eliminatedWeeks.push(week);
        char.eliminatedWeeks.sort(function(a, b) { return a - b; });

        if (typeof window.logActivity === 'function') {
            window.logActivity('Eliminated ' + char.firstName + ' (standalone, Week ' + week + '): ' + reason);
        }

        if (typeof window.saveData === 'function') {
            window.saveData().then(function() {
                renderCharacterList();
                var form = document.getElementById('character-form');
                if (form && !form.classList.contains('hidden')) {
                    showCharacterForm(charId);
                }
                alert('Character eliminated successfully!');
            }).catch(function(err) {
                alert('Failed to save elimination.');
            });
        } else {
            renderCharacterList();
            alert('Character eliminated successfully!');
        }
    }

    function removeStandaloneElimination(charId, index) {
        if (!confirm('Remove this standalone elimination?')) return;
        var data = window.data || {};
        var char = data.characters.find(function(c) { return String(c.id) === String(charId); });
        if (!char || !char.eliminations) return;

        var elim = char.eliminations[index];
        if (!elim || !elim.standalone) return;

        if (char.eliminatedWeeks) {
            var weekIdx = char.eliminatedWeeks.indexOf(parseInt(elim.week));
            if (weekIdx !== -1) {
                char.eliminatedWeeks.splice(weekIdx, 1);
            }
        }

        char.eliminations.splice(index, 1);

        if (typeof window.saveData === 'function') {
            window.saveData().then(function() {
                renderCharacterList();
                showCharacterForm(charId);
                alert('Standalone elimination removed.');
            }).catch(function(err) {
                alert('Failed to remove elimination.');
            });
        } else {
            renderCharacterList();
            showCharacterForm(charId);
            alert('Standalone elimination removed.');
        }
    }

    function saveCharacter(e) {
        e.preventDefault();
        var form = e.target;
        var editId = form.dataset.editId;
        var data = window.data || {};
        var isDeceased = document.getElementById('char-deceased').checked;
        var deathYear = document.getElementById('char-death-year').value.trim();
        var deathCause = document.getElementById('char-death-cause').value.trim();
        var deathAge = document.getElementById('char-death-age').value.trim();

        var careerStatus = [];
        document.querySelectorAll('.career-status-entry').forEach(function(entry) {
            var select = entry.querySelector('.career-status-select');
            var startInput = entry.querySelector('.career-start-year');
            var endInput = entry.querySelector('.career-end-year');
            if (select && select.value) {
                careerStatus.push({
                    status: select.value,
                    startYear: startInput ? startInput.value || '' : '',
                    endYear: endInput ? endInput.value || '' : ''
                });
            }
        });

        var magic = {};
        var magicTypes = ['earth', 'water', 'fire', 'air', 'metal', 'wood',
            'blood', 'bone', 'mind', 'morphic', 'life', 'death',
            'space', 'time', 'dimension', 'void', 'reality', 'transference'
        ];
        magicTypes.forEach(function(key) {
            var input = document.getElementById('magic-' + key);
            if (input) {
                magic[key] = parseInt(input.value) || 0;
            }
        });

        var physicalMoves = [];
        var magicalMoves = [];
        document.querySelectorAll('#physical-moves-list .special-move-entry').forEach(function(el) {
            var nameEl = el.querySelector('.move-name');
            var descEl = el.querySelector('.move-desc');
            if (nameEl) {
                physicalMoves.push({
                    name: nameEl.textContent,
                    description: descEl ? descEl.textContent : ''
                });
            }
        });
        document.querySelectorAll('#magical-moves-list .special-move-entry').forEach(function(el) {
            var nameEl = el.querySelector('.move-name');
            var descEl = el.querySelector('.move-desc');
            if (nameEl) {
                magicalMoves.push({
                    name: nameEl.textContent,
                    description: descEl ? descEl.textContent : ''
                });
            }
        });

        var charData = {
            firstName: document.getElementById('char-firstname').value.trim(),
            middleName: document.getElementById('char-middlename').value.trim(),
            lastName: document.getElementById('char-lastname').value.trim(),
            nickname: document.getElementById('char-nickname').value.trim(),
            alias: document.getElementById('char-alias').value.trim(),
            previousNames: document.getElementById('char-previous-names').value.split(',').map(function(n) { return n.trim(); }).filter(function(n) { return n; }),
            nameFormat: document.getElementById('char-name-format').value || 'firstlast',
            birthYear: document.getElementById('char-birthyear').value || '',
            gender: document.getElementById('char-gender').value.trim(),
            eyes: document.getElementById('char-eyes').value.trim(),
            hair: document.getElementById('char-hair').value.trim(),
            skin: document.getElementById('char-skin').value.trim(),
            height: document.getElementById('char-height').value.trim(),
            weight: document.getElementById('char-weight').value.trim(),
            build: document.getElementById('char-build').value.trim(),
            appearanceNotes: document.getElementById('char-appearance-notes').value.trim(),
            notes: document.getElementById('char-notes').value.trim(),
            deceased: isDeceased,
            deathYear: deathYear,
            deathCause: deathCause,
            deathAge: deathAge,
            careerStatus: careerStatus,
            specialty: document.getElementById('char-specialty').value.trim(),
            personality: {
                traits: document.getElementById('char-traits').value.trim(),
                ideals: document.getElementById('char-ideals').value.trim(),
                bonds: document.getElementById('char-bonds').value.trim(),
                flaws: document.getElementById('char-flaws').value.trim(),
                alignment: document.getElementById('char-alignment').value.trim(),
                likes: document.getElementById('char-likes').value.trim(),
                dislikes: document.getElementById('char-dislikes').value.trim(),
                habits: document.getElementById('char-habits').value.trim(),
                fears: document.getElementById('char-fears').value.trim(),
                goals: document.getElementById('char-goals').value.trim()
            },
            stats: {
                str: parseInt(document.getElementById('char-str').value) || 10,
                dex: parseInt(document.getElementById('char-dex').value) || 10,
                con: parseInt(document.getElementById('char-con').value) || 10,
                int: parseInt(document.getElementById('char-int').value) || 10,
                wis: parseInt(document.getElementById('char-wis').value) || 10,
                cha: parseInt(document.getElementById('char-cha').value) || 10
            },
            magic: magic,
            specialMoves: {
                physical: physicalMoves,
                magical: magicalMoves
            }
        };

        if (editId) {
            var existing = data.characters.find(function(c) { return String(c.id) === String(editId); });
            if (existing && existing.eliminations) {
                charData.eliminations = existing.eliminations.slice();
            }
        }

        if (!charData.firstName) {
            alert('First name is required.');
            return;
        }
        if (!charData.lastName) {
            alert('Last name is required.');
            return;
        }
        if (isDeceased && !deathYear && !deathAge) {
            alert('Please enter either Death Year or Death Age for deceased characters.');
            return;
        }

        if (editId) {
            var index = data.characters.findIndex(function(c) { return String(c.id) === String(editId); });
            if (index !== -1) {
                var existing = data.characters[index];
                if (!charData.eliminations) {
                    charData.eliminations = existing.eliminations || [];
                }
                charData.id = existing.id;
                charData.createdAt = existing.createdAt;
                data.characters[index] = Object.assign({}, existing, charData);
                if (typeof window.logActivity === 'function') {
                    window.logActivity('Updated character: ' + charData.firstName);
                }
            }
        } else {
            var newChar = {
                id: window.generateId('char'),
                firstName: charData.firstName,
                middleName: charData.middleName,
                lastName: charData.lastName,
                nickname: charData.nickname,
                alias: charData.alias,
                previousNames: charData.previousNames,
                nameFormat: charData.nameFormat,
                birthYear: charData.birthYear,
                gender: charData.gender,
                eyes: charData.eyes,
                hair: charData.hair,
                skin: charData.skin,
                height: charData.height,
                weight: charData.weight,
                build: charData.build,
                appearanceNotes: charData.appearanceNotes,
                notes: charData.notes,
                deceased: charData.deceased,
                deathYear: charData.deathYear,
                deathCause: charData.deathCause,
                deathAge: charData.deathAge,
                careerStatus: charData.careerStatus,
                specialty: charData.specialty,
                personality: charData.personality,
                stats: charData.stats,
                magic: charData.magic,
                specialMoves: charData.specialMoves,
                eliminations: [],
                eliminatedWeeks: [],
                createdAt: new Date().toISOString()
            };
            data.characters.push(newChar);
            if (typeof window.logActivity === 'function') {
                window.logActivity('Added character: ' + charData.firstName);
            }
        }

        window.data = data;
        if (typeof window.saveData === 'function') {
            window.saveData().catch(function(err) { /* ignore */ });
        }
        renderCharacterList();
        if (typeof window.updateDashboardStats === 'function') {
            window.updateDashboardStats();
        }
        hideCharacterForm();
    }

    function deleteCharacter(id) {
        if (!confirm('Delete this character permanently?')) return;
        var data = window.data || {};
        var char = data.characters.find(function(c) { return String(c.id) === String(id); });
        if (!char) return;

        data.teams.forEach(function(team) {
            if (team.members) {
                team.members = team.members.filter(function(m) { return String(m.characterId) !== String(id); });
            }
        });

        data.characters = data.characters.filter(function(c) { return String(c.id) !== String(id); });
        if (typeof window.logActivity === 'function') {
            window.logActivity('Deleted character: ' + char.firstName);
        }
        if (typeof window.saveData === 'function') {
            window.saveData().catch(function(err) { /* ignore */ });
        }
        renderCharacterList();
        if (typeof window.updateDashboardStats === 'function') {
            window.updateDashboardStats();
        }
    }

    // Register with TabManager
    if (typeof window.TabManager !== 'undefined') {
        window.TabManager.register('characters', renderCharacters);
    }

    // Handle data loading
    document.addEventListener('dataLoaded', function() {
        var container = document.getElementById('tab-characters');
        if (container && container.style.display !== 'none') {
            renderCharacters(container);
        }
    });

    // If data already loaded, render
    if (window.data) {
        setTimeout(function() {
            var container = document.getElementById('tab-characters');
            if (container && container.style.display !== 'none') {
                renderCharacters(container);
            }
        }, 100);
    }

    // Expose functions globally
    window.renderCharacters = renderCharacters;
    window.renderCharacterList = renderCharacterList;
    window.initCharacterEvents = initCharacterEvents;
    window.showCharacterForm = showCharacterForm;
    window.hideCharacterForm = hideCharacterForm;
    window.saveCharacter = saveCharacter;
    window.deleteCharacter = deleteCharacter;
    window.addCareerStatusEntry = addCareerStatusEntry;
    window.addStandaloneElimination = addStandaloneElimination;
    window.removeStandaloneElimination = removeStandaloneElimination;
    window.renderStandaloneEliminations = renderStandaloneEliminations;
    window.renderTournamentEliminations = renderTournamentEliminations;
    window.renderSpecialMoves = renderSpecialMoves;
    window.addSpecialMove = addSpecialMove;
    window.removeSpecialMove = removeSpecialMove;
    window.updateClassSuggestion = updateClassSuggestion;
    window.updateMagicClassSuggestion = updateMagicClassSuggestion;
    window.updateMagicPowerDisplay = updateMagicPowerDisplay;

})();