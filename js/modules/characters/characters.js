/**
 * js/modules/characters/characters.js - Character Management
 * Redesigned: List as burger menu, main area shows edit form with tabs
 * Path: js/modules/characters/characters.js
 */

(function() {
    'use strict';

    var currentEditId = null;
    var characterListOpen = false;

    function renderCharacters(container) {
        container.innerHTML = getCharactersHTML();
        renderCharacterList();
        initCharacterEvents();
        if (window.data && window.data.characters && window.data.characters.length > 0) {
            // Auto-select first character if available
            var firstChar = window.data.characters[0];
            if (firstChar) {
                showCharacterForm(firstChar.id);
            }
        }
    }

    function getCharactersHTML() {
        return `
            <div class="character-manager">
                <!-- Toggle Button for Character List -->
                <div class="char-list-toggle">
                    <button id="toggle-char-list" class="primary small">☰ Characters</button>
                    <button id="add-character-btn" class="primary small">+ New</button>
                    <span id="current-char-name" style="font-weight:600;color:var(--accent);margin-left:8px;"></span>
                </div>

                <!-- Character List - Collapsible -->
                <div id="char-list-panel" class="char-list-panel">
                    <div class="filter-section compact">
                        <input type="text" id="char-name-filter" placeholder="Search..." style="width:120px;padding:3px 6px;font-size:0.7rem;" />
                        <select id="char-status-filter" style="padding:3px 6px;font-size:0.7rem;width:100px;">
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
                        <button id="clear-char-filter" class="small secondary" style="padding:2px 6px;">✕</button>
                    </div>
                    <div id="characters-container">
                        <p class="empty-state" style="padding:10px;font-size:0.8rem;">No characters</p>
                    </div>
                </div>

                <!-- Character Edit Form -->
                <div id="character-form" class="form-container">
                    <h3 id="form-title">Select a character</h3>
                    <form id="char-form">
                        <!-- TABS -->
                        <div class="char-tabs">
                            <button type="button" class="char-tab-btn active" data-tab="name">Name</button>
                            <button type="button" class="char-tab-btn" data-tab="physical">Physical</button>
                            <button type="button" class="char-tab-btn" data-tab="personality">Personality</button>
                            <button type="button" class="char-tab-btn" data-tab="academic">Academic</button>
                            <button type="button" class="char-tab-btn" data-tab="professional">Professional</button>
                            <button type="button" class="char-tab-btn" data-tab="stats">Stats</button>
                            <button type="button" class="char-tab-btn" data-tab="social">Social</button>
                            <button type="button" class="char-tab-btn" data-tab="notes">Notes</button>
                        </div>

                        <!-- TAB: Name -->
                        <div id="char-tab-name" class="char-tab-panel active">
                            <div class="form-grid">
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
                                <div class="form-group">
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
                            </div>
                        </div>

                        <!-- TAB: Physical -->
                        <div id="char-tab-physical" class="char-tab-panel" style="display:none;">
                            <div class="form-grid">
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
                            </div>
                        </div>

                        <!-- TAB: Personality -->
                        <div id="char-tab-personality" class="char-tab-panel" style="display:none;">
                            <div class="personality-grid">
                                <div class="form-group"><label>Traits</label><input type="text" id="char-traits" placeholder="Brave, Honest, Curious..." /></div>
                                <div class="form-group"><label>Ideals</label><input type="text" id="char-ideals" placeholder="Justice, Freedom, Truth..." /></div>
                                <div class="form-group"><label>Flaws</label><input type="text" id="char-flaws" placeholder="Fear, Pride, Greed..." /></div>
                                <div class="form-group"><label>Alignment</label><input type="text" id="char-alignment" placeholder="Lawful Good, Chaotic Neutral..." /></div>
                                <div class="form-group"><label>Likes</label><input type="text" id="char-likes" placeholder="Music, Books, Combat..." /></div>
                                <div class="form-group"><label>Dislikes</label><input type="text" id="char-dislikes" placeholder="Lies, Injustice, Spiders..." /></div>
                                <div class="form-group"><label>Habits</label><input type="text" id="char-habits" placeholder="Smoking, Pacing, Humming..." /></div>
                                <div class="form-group"><label>Fears</label><input type="text" id="char-fears" placeholder="Heights, Loss, Darkness..." /></div>
                                <div class="form-group"><label>Goals</label><input type="text" id="char-goals" placeholder="Seeking power, Revenge, Peace..." /></div>
                            </div>
                        </div>

                        <!-- TAB: Academic -->
                        <div id="char-tab-academic" class="char-tab-panel" style="display:none;">
                            <div id="academic-view" style="padding:4px 0;">
                                <p class="empty-state" style="padding:8px;font-size:0.8rem;">Loading academic data...</p>
                            </div>
                            <div class="form-group full-width section-divider">
                                <label>Career Status History</label>
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
                            </div>
                            <div class="form-group full-width">
                                <label>Specialty/Discipline</label>
                                <input type="text" id="char-specialty" />
                            </div>
                            <div class="form-group full-width section-divider">
                                <label class="section-label info-label">Tournament Eliminations</label>
                                <div id="tournament-eliminations-view"><p class="empty-state" style="padding:6px;font-size:0.75rem;">None</p></div>
                            </div>
                            <div class="form-group full-width section-divider">
                                <label class="section-label warning-label">Standalone Elimination</label>
                                <div class="elimination-controls">
                                    <label>Week:</label>
                                    <input type="number" id="standalone-elim-week" min="1" max="52" value="1" />
                                    <label>Reason:</label>
                                    <input type="text" id="standalone-elim-reason" placeholder="e.g., Dropped out" />
                                    <button type="button" id="add-standalone-elim-btn" class="small warning-btn">Apply</button>
                                </div>
                                <div id="standalone-eliminations-container"><p class="empty-state" style="padding:6px;font-size:0.75rem;">None</p></div>
                            </div>
                        </div>

                        <!-- TAB: Professional -->
                        <div id="char-tab-professional" class="char-tab-panel" style="display:none;">
                            <div id="professional-view" style="padding:4px 0;">
                                <p class="empty-state" style="padding:8px;font-size:0.8rem;">Loading professional data...</p>
                            </div>
                        </div>

                        <!-- TAB: Stats -->
                        <div id="char-tab-stats" class="char-tab-panel" style="display:none;">
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
                            <div class="magic-grid" style="margin-top:12px;">
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
                            <div class="moves-grid" style="margin-top:12px;">
                                <div class="moves-column">
                                    <label class="move-label physical">Physical Moves</label>
                                    <div id="physical-moves-list" class="moves-list"><p class="empty-state">None</p></div>
                                    <div class="move-input-group">
                                        <input type="text" id="physical-move-name" placeholder="Move name" />
                                        <input type="text" id="physical-move-desc" placeholder="Description" />
                                        <button type="button" id="add-physical-move-btn" class="small primary">+ Add</button>
                                    </div>
                                </div>
                                <div class="moves-column">
                                    <label class="move-label magical">Magical Moves</label>
                                    <div id="magical-moves-list" class="moves-list"><p class="empty-state">None</p></div>
                                    <div class="move-input-group">
                                        <input type="text" id="magical-move-name" placeholder="Move name" />
                                        <input type="text" id="magical-move-desc" placeholder="Description" />
                                        <button type="button" id="add-magical-move-btn" class="small primary">+ Add</button>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <!-- TAB: Social -->
                        <div id="char-tab-social" class="char-tab-panel" style="display:none;">
                            <div id="social-view">
                                <p class="empty-state" style="padding:8px;font-size:0.8rem;">Loading social connections...</p>
                            </div>
                            <div class="form-actions" style="margin-top:8px;">
                                <button type="button" id="add-social-relation-btn" class="primary small">+ Add Connection</button>
                            </div>
                        </div>

                        <!-- TAB: Notes -->
                        <div id="char-tab-notes" class="char-tab-panel" style="display:none;">
                            <div class="form-group full-width">
                                <textarea id="char-notes" rows="6" placeholder="Background, motivations, history..." style="min-height:150px;"></textarea>
                            </div>
                        </div>

                        <div class="form-actions" style="margin-top:12px;border-top:1px solid var(--border-soft);padding-top:12px;">
                            <button type="button" id="delete-char-btn" class="danger">Delete</button>
                            <button type="submit" id="save-char-btn" class="primary">Save Character</button>
                        </div>
                    </form>
                </div>
            </div>
        `;
    }

    function renderCharacterList() {
        var container = document.getElementById('characters-container');
        if (!container) return;

        var data = window.data || {};
        if (!data.characters || data.characters.length === 0) {
            container.innerHTML = '<p class="empty-state" style="padding:10px;font-size:0.8rem;">No characters. Create one!</p>';
            return;
        }

        var statusFilter = document.getElementById('char-status-filter') ? document.getElementById('char-status-filter').value : 'all';
        var nameFilter = document.getElementById('char-name-filter') ? document.getElementById('char-name-filter').value.toLowerCase() : '';

        var filteredChars = data.characters.filter(function(char) {
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
            container.innerHTML = '<p class="empty-state" style="padding:10px;font-size:0.8rem;">No matches</p>';
            return;
        }

        var html = '';
        filteredChars.forEach(function(char) {
            var displayName = window.getDisplayName(char);
            var status = window.getCurrentStatus(char);
            var isDead = char.deceased || false;
            var deadMarker = isDead ? ' ✝' : '';
            var isActive = (char.id === currentEditId);
            var activeClass = isActive ? ' active' : '';

            html += '<div class="char-list-item' + activeClass + '" data-id="' + char.id + '">';
            html += '<span class="char-name">' + displayName + deadMarker + '</span>';
            html += '<span class="char-status" style="font-size:0.6rem;color:var(--text-dim);">' + status + '</span>';
            html += '</div>';
        });
        container.innerHTML = html;

        container.querySelectorAll('.char-list-item').forEach(function(el) {
            el.addEventListener('click', function() {
                var id = this.dataset.id;
                showCharacterForm(id);
                // Close list on mobile after selection
                if (window.innerWidth < 768) {
                    toggleCharacterList(false);
                }
            });
        });
    }

    function toggleCharacterList(open) {
        var panel = document.getElementById('char-list-panel');
        var toggle = document.getElementById('toggle-char-list');
        if (!panel) return;
        
        if (open === undefined) {
            characterListOpen = !characterListOpen;
        } else {
            characterListOpen = open;
        }
        
        panel.classList.toggle('open', characterListOpen);
        if (toggle) {
            toggle.classList.toggle('open', characterListOpen);
        }
    }

    function initCharacterEvents() {
        // Toggle character list
        var toggleBtn = document.getElementById('toggle-char-list');
        if (toggleBtn) {
            var newToggle = toggleBtn.cloneNode(true);
            toggleBtn.parentNode.replaceChild(newToggle, toggleBtn);
            newToggle.addEventListener('click', function(e) {
                e.stopPropagation();
                toggleCharacterList();
            });
        }

        // Add character button
        var addBtn = document.getElementById('add-character-btn');
        if (addBtn) {
            var newAddBtn = addBtn.cloneNode(true);
            addBtn.parentNode.replaceChild(newAddBtn, addBtn);
            newAddBtn.addEventListener('click', function() {
                currentEditId = null;
                showCharacterForm(null);
                // Close list on mobile
                if (window.innerWidth < 768) {
                    toggleCharacterList(false);
                }
            });
        }

        // Form submit
        var form = document.getElementById('char-form');
        if (form) {
            var newForm = form.cloneNode(true);
            form.parentNode.replaceChild(newForm, form);
            newForm.addEventListener('submit', saveCharacter);
        }

        // Delete button
        var deleteBtn = document.getElementById('delete-char-btn');
        if (deleteBtn) {
            var newDeleteBtn = deleteBtn.cloneNode(true);
            deleteBtn.parentNode.replaceChild(newDeleteBtn, deleteBtn);
            newDeleteBtn.addEventListener('click', function() {
                if (currentEditId && confirm('Delete this character permanently?')) {
                    deleteCharacter(currentEditId);
                }
            });
        }

        // Tab switching
        document.querySelectorAll('.char-tab-btn').forEach(function(btn) {
            var newBtn = btn.cloneNode(true);
            btn.parentNode.replaceChild(newBtn, btn);
            newBtn.addEventListener('click', function() {
                var tab = this.dataset.tab;
                switchCharTab(tab);
            });
        });

        // Filter events
        var nameFilter = document.getElementById('char-name-filter');
        if (nameFilter) {
            nameFilter.addEventListener('input', renderCharacterList);
        }
        var statusFilter = document.getElementById('char-status-filter');
        if (statusFilter) {
            statusFilter.addEventListener('change', renderCharacterList);
        }
        var clearFilter = document.getElementById('clear-char-filter');
        if (clearFilter) {
            clearFilter.addEventListener('click', function() {
                document.getElementById('char-name-filter').value = '';
                document.getElementById('char-status-filter').value = 'all';
                renderCharacterList();
            });
        }

        // Career status
        var addStatusBtn = document.getElementById('add-status-btn');
        if (addStatusBtn) {
            var newStatusBtn = addStatusBtn.cloneNode(true);
            addStatusBtn.parentNode.replaceChild(newStatusBtn, addStatusBtn);
            newStatusBtn.addEventListener('click', function() {
                var container = document.getElementById('career-status-container');
                addCareerStatusEntry(container);
            });
        }

        // Eliminations
        var addElimBtn = document.getElementById('add-standalone-elim-btn');
        if (addElimBtn) {
            var newElimBtn = addElimBtn.cloneNode(true);
            addElimBtn.parentNode.replaceChild(newElimBtn, addElimBtn);
            newElimBtn.addEventListener('click', addStandaloneElimination);
        }

        // Deceased toggle
        var deceasedCheck = document.getElementById('char-deceased');
        if (deceasedCheck) {
            var newCheck = deceasedCheck.cloneNode(true);
            deceasedCheck.parentNode.replaceChild(newCheck, deceasedCheck);
            newCheck.addEventListener('change', function() {
                var deathFields = document.getElementById('death-fields');
                if (deathFields) {
                    deathFields.style.display = this.checked ? 'block' : 'none';
                }
            });
        }

        // Stats events
        initStatsEvents();
        initMagicEvents();
        initSpecialMovesEvents();

        // Social add connection
        var socialBtn = document.getElementById('add-social-relation-btn');
        if (socialBtn) {
            var newSocialBtn = socialBtn.cloneNode(true);
            socialBtn.parentNode.replaceChild(newSocialBtn, socialBtn);
            newSocialBtn.addEventListener('click', function() {
                if (!currentEditId) {
                    alert('Please save the character first.');
                    return;
                }
                if (typeof window.showRelationshipForm === 'function') {
                    window.showRelationshipForm(null, currentEditId);
                }
            });
        }

        // Close list when clicking outside
        document.addEventListener('click', function(e) {
            var panel = document.getElementById('char-list-panel');
            var toggle = document.getElementById('toggle-char-list');
            if (panel && panel.classList.contains('open')) {
                if (!panel.contains(e.target) && !toggle.contains(e.target)) {
                    toggleCharacterList(false);
                }
            }
        });
    }

    function switchCharTab(tab) {
        document.querySelectorAll('.char-tab-btn').forEach(function(btn) {
            btn.classList.toggle('active', btn.dataset.tab === tab);
        });
        document.querySelectorAll('.char-tab-panel').forEach(function(panel) {
            var panelId = panel.id.replace('char-tab-', '');
            panel.style.display = panelId === tab ? 'block' : 'none';
            panel.classList.toggle('active', panelId === tab);
        });
    }

    function showCharacterForm(editId) {
        currentEditId = editId;
        var data = window.data || {};
        var form = document.getElementById('character-form');
        var title = document.getElementById('form-title');
        var nameDisplay = document.getElementById('current-char-name');

        // Clear all tabs first
        document.querySelectorAll('.char-tab-panel').forEach(function(p) {
            p.style.display = 'none';
            p.classList.remove('active');
        });
        // Show first tab
        var firstTab = document.querySelector('.char-tab-btn.active');
        if (!firstTab) {
            firstTab = document.querySelector('.char-tab-btn');
        }
        if (firstTab) {
            var tabName = firstTab.dataset.tab;
            var panel = document.getElementById('char-tab-' + tabName);
            if (panel) {
                panel.style.display = 'block';
                panel.classList.add('active');
            }
        }

        if (editId) {
            var char = data.characters.find(function(c) { return String(c.id) === String(editId); });
            if (!char) {
                title.textContent = 'Character not found';
                return;
            }
            title.textContent = 'Edit Character';
            if (nameDisplay) nameDisplay.textContent = window.getDisplayName(char);

            // Populate form fields
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

            // Personality
            var p = char.personality || {};
            document.getElementById('char-traits').value = p.traits || '';
            document.getElementById('char-ideals').value = p.ideals || '';
            document.getElementById('char-flaws').value = p.flaws || '';
            document.getElementById('char-alignment').value = p.alignment || '';
            document.getElementById('char-likes').value = p.likes || '';
            document.getElementById('char-dislikes').value = p.dislikes || '';
            document.getElementById('char-habits').value = p.habits || '';
            document.getElementById('char-fears').value = p.fears || '';
            document.getElementById('char-goals').value = p.goals || '';

            // Stats
            var stats = window.getCharacterStats(char);
            document.getElementById('char-str').value = stats.str || 10;
            document.getElementById('char-dex').value = stats.dex || 10;
            document.getElementById('char-con').value = stats.con || 10;
            document.getElementById('char-int').value = stats.int || 10;
            document.getElementById('char-wis').value = stats.wis || 10;
            document.getElementById('char-cha').value = stats.cha || 10;
            updateClassSuggestion();

            // Magic
            var magic = window.getCharacterMagic(char);
            for (var key in magic) {
                var input = document.getElementById('magic-' + key);
                if (input) {
                    input.value = magic[key] || 0;
                }
            }
            updateMagicClassSuggestion();
            updateMagicPowerDisplay();

            // Special moves
            var moves = window.getSpecialMoves(char);
            renderSpecialMoves('physical-moves-list', moves.physical, 'physical');
            renderSpecialMoves('magical-moves-list', moves.magical, 'magical');

            // Career status
            var container = document.getElementById('career-status-container');
            container.innerHTML = '';
            if (char.careerStatus && char.careerStatus.length > 0) {
                char.careerStatus.forEach(function(status) {
                    addCareerStatusEntry(container, status.status, status.startYear, status.endYear);
                });
            } else {
                addCareerStatusEntry(container);
            }

            // Eliminations
            renderStandaloneEliminations(char);
            renderTournamentEliminations(char);

            // Academic view
            renderAcademicView(char);
            renderProfessionalView(char);
            renderSocialView(char);

            var formElement = document.getElementById('char-form');
            if (formElement) formElement.dataset.editId = editId;

            // Update list
            renderCharacterList();

        } else {
            // New character
            title.textContent = 'New Character';
            if (nameDisplay) nameDisplay.textContent = 'New Character';
            var formElement = document.getElementById('char-form');
            if (formElement) {
                formElement.reset();
                delete formElement.dataset.editId;
            }
            
            // Reset form fields
            document.getElementById('char-str').value = 10;
            document.getElementById('char-dex').value = 10;
            document.getElementById('char-con').value = 10;
            document.getElementById('char-int').value = 10;
            document.getElementById('char-wis').value = 10;
            document.getElementById('char-cha').value = 10;
            updateClassSuggestion();

            var container = document.getElementById('career-status-container');
            container.innerHTML = '';
            addCareerStatusEntry(container);

            document.getElementById('char-deceased').checked = false;
            document.getElementById('death-fields').style.display = 'none';
            document.getElementById('specialty-field').style.display = 'none';

            document.getElementById('academic-view').innerHTML = '<p class="empty-state" style="padding:8px;font-size:0.8rem;">Save character to view academic data</p>';
            document.getElementById('professional-view').innerHTML = '<p class="empty-state" style="padding:8px;font-size:0.8rem;">Save character to view professional data</p>';
            document.getElementById('social-view').innerHTML = '<p class="empty-state" style="padding:8px;font-size:0.8rem;">Save character to view social connections</p>';
            document.getElementById('standalone-eliminations-container').innerHTML = '<p class="empty-state" style="padding:6px;font-size:0.75rem;">None</p>';
            document.getElementById('tournament-eliminations-view').innerHTML = '<p class="empty-state" style="padding:6px;font-size:0.75rem;">None</p>';

            renderCharacterList();
        }

        // Ensure form is visible
        form.style.display = 'block';
        form.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    function renderAcademicView(char) {
        var container = document.getElementById('academic-view');
        if (!container) return;

        var data = window.data || {};
        var html = '';

        // Academic Teams
        html += '<h4 style="color:var(--accent);font-size:0.8rem;margin:8px 0 4px 0;">Academic Teams</h4>';
        var acadTeams = data.teams ? data.teams.filter(function(t) {
            if (t.type !== 'academic') return false;
            if (t.status === 'deleted') return false;
            return t.members && t.members.some(function(m) { return String(m.characterId) === String(char.id); });
        }) : [];

        if (acadTeams.length > 0) {
            acadTeams.forEach(function(team) {
                var member = team.members.find(function(m) { return String(m.characterId) === String(char.id); });
                var period = member ? (member.joinPeriod || '?') : '?';
                if (member && member.leavePeriod) period += ' → ' + member.leavePeriod;
                html += '<div style="padding:3px 8px;background:var(--bg);border-radius:4px;border-left:3px solid var(--accent);margin-bottom:3px;font-size:0.75rem;">';
                html += '<strong>' + team.name + '</strong> <span style="color:var(--text-dim);font-size:0.7rem;">(Wk ' + period + ')</span>';
                if (member && member.role) html += ' <span style="color:var(--text-dim);font-size:0.65rem;">[' + member.role + ']</span>';
                html += '</div>';
            });
        } else {
            html += '<p class="empty-state" style="padding:4px;font-size:0.7rem;">No academic teams</p>';
        }

        // Grades
        html += '<h4 style="color:var(--info);font-size:0.8rem;margin:8px 0 4px 0;">Grades</h4>';
        var curriculum = data.curriculum || {};
        var grades = curriculum.grades && curriculum.grades[char.id] ? curriculum.grades[char.id] : {};
        var classCount = 0;
        for (var week in grades) {
            for (var discId in grades[week]) {
                classCount++;
            }
        }

        if (classCount > 0) {
            html += '<div style="max-height:100px;overflow-y:auto;font-size:0.7rem;">';
            for (var week in grades) {
                for (var discId in grades[week]) {
                    var disc = window.getDiscipline(discId);
                    var score = grades[week][discId];
                    html += '<div style="padding:2px 8px;background:var(--bg);border-radius:3px;margin-bottom:2px;display:flex;justify-content:space-between;">';
                    html += '<span>' + (disc ? disc.name : 'Unknown') + ' (Wk ' + week + ')</span>';
                    html += '<span style="color:var(--accent);font-weight:600;">' + score + '%</span>';
                    html += '</div>';
                }
            }
            html += '</div>';
        } else {
            html += '<p class="empty-state" style="padding:4px;font-size:0.7rem;">No grades recorded</p>';
        }

        container.innerHTML = html;
    }

    function renderProfessionalView(char) {
        var container = document.getElementById('professional-view');
        if (!container) return;

        var data = window.data || {};
        var html = '';

        // Professional Teams
        html += '<h4 style="color:var(--info);font-size:0.8rem;margin:8px 0 4px 0;">Professional Teams</h4>';
        var profTeams = data.teams ? data.teams.filter(function(t) {
            if (t.type !== 'professional') return false;
            if (t.status === 'deleted') return false;
            return t.members && t.members.some(function(m) { return String(m.characterId) === String(char.id); });
        }) : [];

        if (profTeams.length > 0) {
            profTeams.forEach(function(team) {
                var member = team.members.find(function(m) { return String(m.characterId) === String(char.id); });
                var period = member ? (member.joinPeriod || '?') : '?';
                if (member && member.leavePeriod) period += ' → ' + member.leavePeriod;
                html += '<div style="padding:3px 8px;background:var(--bg);border-radius:4px;border-left:3px solid var(--info);margin-bottom:3px;font-size:0.75rem;">';
                html += '<strong>' + team.name + '</strong> <span style="color:var(--text-dim);font-size:0.7rem;">(' + period + ')</span>';
                if (member && member.role) html += ' <span style="color:var(--text-dim);font-size:0.65rem;">[' + member.role + ']</span>';
                html += '</div>';
            });
        } else {
            html += '<p class="empty-state" style="padding:4px;font-size:0.7rem;">No professional teams</p>';
        }

        // Temporary Teams
        html += '<h4 style="color:var(--warning);font-size:0.8rem;margin:8px 0 4px 0;">Temporary Teams</h4>';
        var tempTeams = data.teams ? data.teams.filter(function(t) {
            if (t.type !== 'temporary' && t.type !== 'internship') return false;
            if (t.status === 'deleted') return false;
            return t.members && t.members.some(function(m) { return String(m.characterId) === String(char.id); });
        }) : [];

        if (tempTeams.length > 0) {
            tempTeams.forEach(function(team) {
                var member = team.members.find(function(m) { return String(m.characterId) === String(char.id); });
                var period = member ? (member.joinPeriod || '?') : '?';
                if (member && member.leavePeriod) period += ' → ' + member.leavePeriod;
                html += '<div style="padding:3px 8px;background:var(--bg);border-radius:4px;border-left:3px solid var(--warning);margin-bottom:3px;font-size:0.75rem;">';
                html += '<strong>' + team.name + '</strong> <span style="color:var(--text-dim);font-size:0.7rem;">(' + period + ')</span>';
                if (member && member.role) html += ' <span style="color:var(--text-dim);font-size:0.65rem;">[' + member.role + ']</span>';
                html += '</div>';
            });
        } else {
            html += '<p class="empty-state" style="padding:4px;font-size:0.7rem;">No temporary teams</p>';
        }

        // Civilian Teams
        html += '<h4 style="color:var(--text-dim);font-size:0.8rem;margin:8px 0 4px 0;">Civilian Teams</h4>';
        var civTeams = data.teams ? data.teams.filter(function(t) {
            if (t.type !== 'civilian') return false;
            if (t.status === 'deleted') return false;
            return t.members && t.members.some(function(m) { return String(m.characterId) === String(char.id); });
        }) : [];

        if (civTeams.length > 0) {
            civTeams.forEach(function(team) {
                var member = team.members.find(function(m) { return String(m.characterId) === String(char.id); });
                var period = member ? (member.joinPeriod || '?') : '?';
                if (member && member.leavePeriod) period += ' → ' + member.leavePeriod;
                html += '<div style="padding:3px 8px;background:var(--bg);border-radius:4px;border-left:3px solid var(--text-dim);margin-bottom:3px;font-size:0.75rem;">';
                html += '<strong>' + team.name + '</strong> <span style="color:var(--text-dim);font-size:0.7rem;">(' + period + ')</span>';
                if (member && member.role) html += ' <span style="color:var(--text-dim);font-size:0.65rem;">[' + member.role + ']</span>';
                html += '</div>';
            });
        } else {
            html += '<p class="empty-state" style="padding:4px;font-size:0.7rem;">No civilian teams</p>';
        }

        // Missions
        html += '<h4 style="color:var(--warning);font-size:0.8rem;margin:8px 0 4px 0;">Missions</h4>';
        var missions = data.missions ? data.missions.filter(function(m) {
            return m.assignedTeamId && data.teams && data.teams.some(function(t) {
                return String(t.id) === String(m.assignedTeamId) &&
                       t.members && t.members.some(function(mem) { return String(mem.characterId) === String(char.id); });
            });
        }) : [];

        if (missions.length > 0) {
            missions.forEach(function(m) {
                var statusColor = m.status === 'completed' ? 'var(--accent)' : m.status === 'cancelled' ? 'var(--danger)' : 'var(--warning)';
                html += '<div style="padding:3px 8px;background:var(--bg);border-radius:4px;border-left:3px solid ' + statusColor + ';margin-bottom:3px;font-size:0.75rem;">';
                html += '<strong>' + m.title + '</strong> <span style="color:' + statusColor + ';font-size:0.65rem;">' + (m.status || 'active') + '</span>';
                if (m.location) html += ' <span style="color:var(--text-dim);font-size:0.65rem;">(' + m.location + ')</span>';
                html += '</div>';
            });
        } else {
            html += '<p class="empty-state" style="padding:4px;font-size:0.7rem;">No missions assigned</p>';
        }

        container.innerHTML = html;
    }

    function renderSocialView(char) {
        var container = document.getElementById('social-view');
        if (!container) return;

        var data = window.data || {};
        var rels = data.social && data.social.relationships ? 
            data.social.relationships.filter(function(r) {
                return String(r.character1) === String(char.id) || String(r.character2) === String(char.id);
            }) : [];

        if (rels.length === 0) {
            container.innerHTML = '<p class="empty-state" style="padding:8px;font-size:0.8rem;">No social connections</p>';
            return;
        }

        var html = '';
        rels.forEach(function(rel) {
            var otherId = String(rel.character1) === String(char.id) ? rel.character2 : rel.character1;
            var other = window.getCharacterById(otherId);
            var otherName = other ? window.getDisplayName(other) : 'Unknown';
            var typeLabel = getRelationshipTypeLabel(rel.typeId);
            var typeColor = getRelationshipTypeColor(rel.typeId);
            var period = '';
            if (rel.startYear && rel.endYear) {
                period = rel.startYear + ' → ' + rel.endYear;
            } else if (rel.startYear) {
                period = 'From ' + rel.startYear;
            }
            var clarification = rel.clarification ? ' (' + rel.clarification + ')' : '';

            html += '<div style="display:flex;justify-content:space-between;align-items:center;padding:3px 8px;background:var(--bg);border-radius:4px;border-left:3px solid ' + typeColor + ';margin-bottom:3px;font-size:0.75rem;">';
            html += '<span><strong>' + otherName + '</strong> <span style="color:' + typeColor + ';">' + typeLabel + clarification + '</span></span>';
            html += '<span style="font-size:0.65rem;color:var(--text-dim);">' + period + '</span>';
            html += '</div>';
        });
        container.innerHTML = html;
    }

    function getRelationshipTypeLabel(typeId) {
        var data = window.data || {};
        if (!data.social || !data.social.relationshipTypes) return typeId || 'Other';
        var type = data.social.relationshipTypes.find(function(t) { return t.id === typeId; });
        return type ? type.label : typeId || 'Other';
    }

    function getRelationshipTypeColor(typeId) {
        var data = window.data || {};
        if (!data.social || !data.social.relationshipTypes) return '#7f8c8d';
        var type = data.social.relationshipTypes.find(function(t) { return t.id === typeId; });
        return type ? type.color : '#7f8c8d';
    }

    // ... (keep existing helper functions: addCareerStatusEntry, renderStandaloneEliminations, 
    // renderTournamentEliminations, addStandaloneElimination, removeStandaloneElimination,
    // saveCharacter, deleteCharacter, initStatsEvents, initMagicEvents, initSpecialMovesEvents,
    // updateClassSuggestion, updateMagicClassSuggestion, updateMagicPowerDisplay,
    // renderSpecialMoves, addSpecialMove, removeSpecialMove, generateRandomMagicCategory,
    // populateClassSelect)

    // Register with TabManager
    if (typeof window.TabManager !== 'undefined') {
        window.TabManager.register('characters', renderCharacters);
    }

    document.addEventListener('dataLoaded', function() {
        var container = document.getElementById('tab-characters');
        if (container) {
            renderCharacters(container);
        }
    });

    if (window.data) {
        setTimeout(function() {
            var container = document.getElementById('tab-characters');
            if (container) {
                renderCharacters(container);
            }
        }, 100);
    }

    window.renderCharacters = renderCharacters;
    window.showCharacterForm = showCharacterForm;
    window.renderCharacterList = renderCharacterList;
    window.switchCharTab = switchCharTab;

    console.log('characters.js loaded');

})();
