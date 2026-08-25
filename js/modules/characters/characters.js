/**
 * js/modules/characters/characters.js - Character Management
 * Path: js/modules/characters/characters.js
 */

(function() {
    'use strict';

    var currentEditId = null;
    var characterListOpen = false;

    function renderCharacters(container) {
        if (!container) {
            container = document.getElementById('tab-characters');
        }
        if (!container) return;

        if (!window.data) {
            container.innerHTML = '<p class="empty-state">Loading data...</p>';
            return;
        }

        if (!window.data.characters) {
            window.data.characters = [];
        }
        if (!window.data.classes) {
            window.data.classes = [];
        }

        container.innerHTML = getCharactersHTML();
        renderCharacterList();
        initCharacterEvents();
        
        if (window.data.characters && window.data.characters.length > 0) {
            var firstChar = window.data.characters[0];
            if (firstChar) {
                showCharacterForm(firstChar.id);
            }
        }
        updateClassSuggestion();
        updateMagicClassSuggestion();
        updateMagicPowerDisplay();
    }

    function getCharactersHTML() {
        return `
            <div class="character-manager">
                <div class="char-list-toggle">
                    <button id="toggle-char-list" class="primary small">☰ Characters</button>
                    <button id="add-character-btn" class="primary small">+ New</button>
                    <span id="current-char-name" style="font-weight:600;color:var(--accent);margin-left:8px;"></span>
                </div>

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
                        <select id="char-class-filter" style="padding:3px 6px;font-size:0.7rem;width:120px;">
                            <option value="all">All Classes</option>
                        </select>
                        <button id="clear-char-filter" class="small secondary" style="padding:2px 6px;">✕</button>
                    </div>
                    <div id="characters-container">
                        <p class="empty-state" style="padding:10px;font-size:0.8rem;">No characters</p>
                    </div>
                </div>

                <div id="character-form" class="form-container">
                    <h3 id="form-title">Select a character</h3>
                    <form id="char-form">
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
                                <!-- CLASSES -->
                                <div class="form-group full-width section-divider">
                                    <label>Classes</label>
                                    <div id="class-tag-container" style="display:flex;flex-wrap:wrap;gap:4px;padding:4px;background:var(--panel-alt);border:1px solid var(--border);border-radius:6px;min-height:36px;">
                                        <span style="color:var(--text-dim);font-size:0.7rem;padding:4px;">No classes assigned</span>
                                    </div>
                                    <input type="text" id="class-tag-input" placeholder="Type class name and press Enter..." style="width:100%;padding:4px 6px;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:6px;margin-top:4px;font-size:0.7rem;">
                                    <span style="font-size:0.6rem;color:var(--text-dim);">Press Enter to add a class. Click ✕ on a tag to remove it.</span>
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

                        <!-- TAB: Academic - UPDATED with Class Management -->
                        <div id="char-tab-academic" class="char-tab-panel" style="display:none;">
                            <div id="academic-view" style="padding:4px 0;">
                                <p class="empty-state" style="padding:8px;font-size:0.8rem;">Loading academic data...</p>
                            </div>
                            <!-- Class Management Section -->
                            <div class="form-group full-width section-divider">
                                <label class="section-label">Class Management</label>
                                <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:4px;">
                                    <select id="academic-class-select" style="flex:1;min-width:150px;padding:6px;background:var(--panel-alt);border:1px solid var(--border);color:var(--text);border-radius:6px;">
                                        <option value="">Select a class...</option>
                                    </select>
                                    <button id="add-to-class-btn" class="primary small">Add to Class</button>
                                    <button id="remove-from-class-btn" class="danger small">Remove from Class</button>
                                </div>
                                <div id="character-classes-display" style="margin-top:8px;padding:8px;background:var(--bg);border-radius:4px;border:1px solid var(--border-soft);">
                                    <span style="color:var(--text-dim);font-size:0.7rem;">Current Classes: <span id="current-classes-list">None</span></span>
                                </div>
                            </div>
                            <div class="form-group full-width section-divider">
                                <label>Tournament Eliminations</label>
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
                            <div class="form-group full-width">
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
                            <div id="professional-view" style="padding:4px 0;">
                                <p class="empty-state" style="padding:8px;font-size:0.8rem;">Loading professional data...</p>
                            </div>
                        </div>

                        <!-- TAB: Stats -->
                        <div id="char-tab-stats" class="char-tab-panel" style="display:none;">
                            <div class="stat-input-group">
                                <div class="form-group"><label>STR</label><input type="number" id="char-str" min="1" max="30" value="10" style="text-align:center;font-size:0.75rem;padding:4px;width:100%;background:var(--panel-alt);border:1px solid var(--border);color:var(--text);border-radius:6px;" /></div>
                                <div class="form-group"><label>DEX</label><input type="number" id="char-dex" min="1" max="30" value="10" style="text-align:center;font-size:0.75rem;padding:4px;width:100%;background:var(--panel-alt);border:1px solid var(--border);color:var(--text);border-radius:6px;" /></div>
                                <div class="form-group"><label>CON</label><input type="number" id="char-con" min="1" max="30" value="10" style="text-align:center;font-size:0.75rem;padding:4px;width:100%;background:var(--panel-alt);border:1px solid var(--border);color:var(--text);border-radius:6px;" /></div>
                                <div class="form-group"><label>INT</label><input type="number" id="char-int" min="1" max="30" value="10" style="text-align:center;font-size:0.75rem;padding:4px;width:100%;background:var(--panel-alt);border:1px solid var(--border);color:var(--text);border-radius:6px;" /></div>
                                <div class="form-group"><label>WIS</label><input type="number" id="char-wis" min="1" max="30" value="10" style="text-align:center;font-size:0.75rem;padding:4px;width:100%;background:var(--panel-alt);border:1px solid var(--border);color:var(--text);border-radius:6px;" /></div>
                                <div class="form-group"><label>CHA</label><input type="number" id="char-cha" min="1" max="30" value="10" style="text-align:center;font-size:0.75rem;padding:4px;width:100%;background:var(--panel-alt);border:1px solid var(--border);color:var(--text);border-radius:6px;" /></div>
                            </div>
                            <div class="stat-actions" style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:8px;padding:8px;background:var(--bg);border-radius:6px;border:1px solid var(--border-soft);">
                                <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;flex:1;">
                                    <label class="stat-label" style="font-size:0.7rem;color:var(--text-dim);">Class:</label>
                                    <span id="suggested-class" class="suggested-class empty">—</span>
                                    <select id="manual-class-select" style="padding:4px 8px;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:6px;font-size:0.7rem;">
                                        <option value="">Auto-suggest</option>
                                    </select>
                                    <button type="button" id="recalculate-class-btn" class="small secondary" style="font-size:0.6rem;padding:2px 8px;">Recalc</button>
                                    <button type="button" id="random-stats-btn" class="small secondary" style="font-size:0.6rem;padding:2px 8px;">Random</button>
                                </div>
                            </div>
                            <div id="class-description-display" style="margin-top:6px;padding:6px 10px;background:var(--panel-alt);border-radius:4px;font-size:0.7rem;color:var(--text-dim);border-left:3px solid var(--accent);">
                                Select a class to see its description here.
                            </div>

                            <!-- Magic Stats -->
                            <div class="magic-stats-grid" style="display:grid;grid-template-columns:repeat(6,1fr);gap:6px;margin-top:12px;">
                                <div class="form-group" style="grid-column:1/-1;margin:6px 0 2px 0;display:flex;align-items:center;gap:8px;">
                                    <label style="color:var(--accent);font-weight:600;font-size:0.7rem;">Elemental</label>
                                    <button type="button" id="random-elemental-btn" class="small secondary" style="font-size:0.5rem;padding:1px 6px;">Random</button>
                                </div>
                                <div class="form-group"><label style="font-size:0.55rem;text-align:center;display:block;">Earth</label><input type="number" id="magic-earth" min="0" max="10" value="0" style="text-align:center;font-size:0.75rem;padding:4px;width:100%;background:var(--panel-alt);border:1px solid var(--border);color:var(--text);border-radius:6px;" /></div>
                                <div class="form-group"><label style="font-size:0.55rem;text-align:center;display:block;">Water</label><input type="number" id="magic-water" min="0" max="10" value="0" style="text-align:center;font-size:0.75rem;padding:4px;width:100%;background:var(--panel-alt);border:1px solid var(--border);color:var(--text);border-radius:6px;" /></div>
                                <div class="form-group"><label style="font-size:0.55rem;text-align:center;display:block;">Fire</label><input type="number" id="magic-fire" min="0" max="10" value="0" style="text-align:center;font-size:0.75rem;padding:4px;width:100%;background:var(--panel-alt);border:1px solid var(--border);color:var(--text);border-radius:6px;" /></div>
                                <div class="form-group"><label style="font-size:0.55rem;text-align:center;display:block;">Air</label><input type="number" id="magic-air" min="0" max="10" value="0" style="text-align:center;font-size:0.75rem;padding:4px;width:100%;background:var(--panel-alt);border:1px solid var(--border);color:var(--text);border-radius:6px;" /></div>
                                <div class="form-group"><label style="font-size:0.55rem;text-align:center;display:block;">Metal</label><input type="number" id="magic-metal" min="0" max="10" value="0" style="text-align:center;font-size:0.75rem;padding:4px;width:100%;background:var(--panel-alt);border:1px solid var(--border);color:var(--text);border-radius:6px;" /></div>
                                <div class="form-group"><label style="font-size:0.55rem;text-align:center;display:block;">Wood</label><input type="number" id="magic-wood" min="0" max="10" value="0" style="text-align:center;font-size:0.75rem;padding:4px;width:100%;background:var(--panel-alt);border:1px solid var(--border);color:var(--text);border-radius:6px;" /></div>
                                
                                <div class="form-group" style="grid-column:1/-1;margin:6px 0 2px 0;display:flex;align-items:center;gap:8px;">
                                    <label style="color:var(--danger);font-weight:600;font-size:0.7rem;">Body</label>
                                    <button type="button" id="random-body-btn" class="small secondary" style="font-size:0.5rem;padding:1px 6px;">Random</button>
                                </div>
                                <div class="form-group"><label style="font-size:0.55rem;text-align:center;display:block;">Blood</label><input type="number" id="magic-blood" min="0" max="10" value="0" style="text-align:center;font-size:0.75rem;padding:4px;width:100%;background:var(--panel-alt);border:1px solid var(--border);color:var(--text);border-radius:6px;" /></div>
                                <div class="form-group"><label style="font-size:0.55rem;text-align:center;display:block;">Bone</label><input type="number" id="magic-bone" min="0" max="10" value="0" style="text-align:center;font-size:0.75rem;padding:4px;width:100%;background:var(--panel-alt);border:1px solid var(--border);color:var(--text);border-radius:6px;" /></div>
                                <div class="form-group"><label style="font-size:0.55rem;text-align:center;display:block;">Mind</label><input type="number" id="magic-mind" min="0" max="10" value="0" style="text-align:center;font-size:0.75rem;padding:4px;width:100%;background:var(--panel-alt);border:1px solid var(--border);color:var(--text);border-radius:6px;" /></div>
                                <div class="form-group"><label style="font-size:0.55rem;text-align:center;display:block;">Morphic</label><input type="number" id="magic-morphic" min="0" max="10" value="0" style="text-align:center;font-size:0.75rem;padding:4px;width:100%;background:var(--panel-alt);border:1px solid var(--border);color:var(--text);border-radius:6px;" /></div>
                                <div class="form-group"><label style="font-size:0.55rem;text-align:center;display:block;">Life</label><input type="number" id="magic-life" min="0" max="10" value="0" style="text-align:center;font-size:0.75rem;padding:4px;width:100%;background:var(--panel-alt);border:1px solid var(--border);color:var(--text);border-radius:6px;" /></div>
                                <div class="form-group"><label style="font-size:0.55rem;text-align:center;display:block;">Death</label><input type="number" id="magic-death" min="0" max="10" value="0" style="text-align:center;font-size:0.75rem;padding:4px;width:100%;background:var(--panel-alt);border:1px solid var(--border);color:var(--text);border-radius:6px;" /></div>
                                
                                <div class="form-group" style="grid-column:1/-1;margin:6px 0 2px 0;display:flex;align-items:center;gap:8px;">
                                    <label style="color:var(--info);font-weight:600;font-size:0.7rem;">Aether</label>
                                    <button type="button" id="random-aether-btn" class="small secondary" style="font-size:0.5rem;padding:1px 6px;">Random</button>
                                </div>
                                <div class="form-group"><label style="font-size:0.55rem;text-align:center;display:block;">Space</label><input type="number" id="magic-space" min="0" max="10" value="0" style="text-align:center;font-size:0.75rem;padding:4px;width:100%;background:var(--panel-alt);border:1px solid var(--border);color:var(--text);border-radius:6px;" /></div>
                                <div class="form-group"><label style="font-size:0.55rem;text-align:center;display:block;">Time</label><input type="number" id="magic-time" min="0" max="10" value="0" style="text-align:center;font-size:0.75rem;padding:4px;width:100%;background:var(--panel-alt);border:1px solid var(--border);color:var(--text);border-radius:6px;" /></div>
                                <div class="form-group"><label style="font-size:0.55rem;text-align:center;display:block;">Dimension</label><input type="number" id="magic-dimension" min="0" max="10" value="0" style="text-align:center;font-size:0.75rem;padding:4px;width:100%;background:var(--panel-alt);border:1px solid var(--border);color:var(--text);border-radius:6px;" /></div>
                                <div class="form-group"><label style="font-size:0.55rem;text-align:center;display:block;">Void</label><input type="number" id="magic-void" min="0" max="10" value="0" style="text-align:center;font-size:0.75rem;padding:4px;width:100%;background:var(--panel-alt);border:1px solid var(--border);color:var(--text);border-radius:6px;" /></div>
                                <div class="form-group"><label style="font-size:0.55rem;text-align:center;display:block;">Reality</label><input type="number" id="magic-reality" min="0" max="10" value="0" style="text-align:center;font-size:0.75rem;padding:4px;width:100%;background:var(--panel-alt);border:1px solid var(--border);color:var(--text);border-radius:6px;" /></div>
                                <div class="form-group"><label style="font-size:0.55rem;text-align:center;display:block;">Transference</label><input type="number" id="magic-transference" min="0" max="10" value="0" style="text-align:center;font-size:0.75rem;padding:4px;width:100%;background:var(--panel-alt);border:1px solid var(--border);color:var(--text);border-radius:6px;" /></div>
                            </div>

                            <div class="magic-actions" style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:8px;padding:8px;background:var(--bg);border-radius:6px;border:1px solid var(--border-soft);">
                                <label class="stat-label" style="font-size:0.7rem;color:var(--text-dim);">Magic Class:</label>
                                <span id="suggested-magic-class" class="suggested-class empty">—</span>
                                <select id="manual-magic-class-select" style="padding:4px 8px;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:6px;font-size:0.7rem;">
                                    <option value="">Auto-suggest</option>
                                </select>
                                <button type="button" id="recalculate-magic-class-btn" class="small secondary" style="font-size:0.6rem;padding:2px 8px;">Recalc</button>
                            </div>
                            <div class="magic-power-display" style="margin-top:6px;font-size:0.7rem;color:var(--text-dim);">
                                Magic Power: <span id="magic-power-display-text">○○○○○ (0/180)</span>
                            </div>
                            <div class="moves-grid" style="margin-top:12px;display:grid;grid-template-columns:1fr 1fr;gap:8px;">
                                <div class="moves-column" style="background:var(--panel-alt);padding:6px;border-radius:6px;border:1px solid var(--border-soft);">
                                    <label class="move-label physical" style="font-size:0.65rem;font-weight:600;color:var(--accent);">Physical Moves</label>
                                    <div id="physical-moves-list" class="moves-list" style="margin-top:2px;max-height:70px;overflow-y:auto;"><p class="empty-state" style="padding:4px;font-size:0.7rem;">None</p></div>
                                    <div class="move-input-group" style="margin-top:4px;">
                                        <input type="text" id="physical-move-name" placeholder="Move name" style="width:100%;padding:2px 4px;font-size:0.6rem;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:4px;margin-bottom:2px;" />
                                        <input type="text" id="physical-move-desc" placeholder="Description" style="width:100%;padding:2px 4px;font-size:0.6rem;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:4px;margin-bottom:2px;" />
                                        <button type="button" id="add-physical-move-btn" class="small primary" style="font-size:0.6rem;padding:2px 8px;">+ Add</button>
                                    </div>
                                </div>
                                <div class="moves-column" style="background:var(--panel-alt);padding:6px;border-radius:6px;border:1px solid var(--border-soft);">
                                    <label class="move-label magical" style="font-size:0.65rem;font-weight:600;color:var(--info);">Magical Moves</label>
                                    <div id="magical-moves-list" class="moves-list" style="margin-top:2px;max-height:70px;overflow-y:auto;"><p class="empty-state" style="padding:4px;font-size:0.7rem;">None</p></div>
                                    <div class="move-input-group" style="margin-top:4px;">
                                        <input type="text" id="magical-move-name" placeholder="Move name" style="width:100%;padding:2px 4px;font-size:0.6rem;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:4px;margin-bottom:2px;" />
                                        <input type="text" id="magical-move-desc" placeholder="Description" style="width:100%;padding:2px 4px;font-size:0.6rem;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:4px;margin-bottom:2px;" />
                                        <button type="button" id="add-magical-move-btn" class="small primary" style="font-size:0.6rem;padding:2px 8px;">+ Add</button>
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
        var classFilter = document.getElementById('char-class-filter') ? document.getElementById('char-class-filter').value : 'all';

        var classFilterSelect = document.getElementById('char-class-filter');
        if (classFilterSelect) {
            var classes = window.getClasses();
            var currentValue = classFilterSelect.value;
            classFilterSelect.innerHTML = '<option value="all">All Classes</option>';
            classes.forEach(function(cls) {
                var option = document.createElement('option');
                option.value = cls.id;
                option.textContent = cls.name;
                classFilterSelect.appendChild(option);
            });
            if (currentValue) classFilterSelect.value = currentValue;
        }

        var filteredChars = data.characters
            .filter(function(char) {
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
                if (classFilter !== 'all') {
                    if (!char.classIds || !char.classIds.some(function(cid) { return String(cid) === String(classFilter); })) {
                        return false;
                    }
                }
                return true;
            })
            .sort(function(a, b) {
                var nameA = window.getDisplayName(a).toLowerCase();
                var nameB = window.getDisplayName(b).toLowerCase();
                return nameA.localeCompare(nameB);
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
            
            var statusIndicator = '';
            var statusColor = 'var(--text-dim)';
            var statusLower = status.toLowerCase();
            if (statusLower === 'trainee' || statusLower === 'rookie') {
                statusIndicator = '▸';
                statusColor = 'var(--accent)';
            } else if (statusLower === 'junior' || statusLower === 'senior') {
                statusIndicator = '◆';
                statusColor = 'var(--warning)';
            } else if (statusLower === 'instructor') {
                statusIndicator = '◇';
                statusColor = 'var(--info)';
            } else if (statusLower === 'support') {
                statusIndicator = '◈';
                statusColor = 'var(--info)';
            } else if (statusLower === 'civilian') {
                statusIndicator = '○';
                statusColor = 'var(--text-dim)';
            }

            var classNames = [];
            if (char.classIds && char.classIds.length > 0) {
                var classes = window.getClasses();
                char.classIds.forEach(function(cid) {
                    var cls = classes.find(function(c) { return String(c.id) === String(cid); });
                    if (cls) classNames.push(cls.name);
                });
            }
            var classDisplay = classNames.length > 0 ? ' [' + classNames.join(', ') + ']' : '';

            html += '<div class="char-list-item' + activeClass + '" data-id="' + char.id + '">';
            html += '<span class="char-name">' + displayName + deadMarker + classDisplay + '</span>';
            html += '<span class="char-status" style="font-size:0.6rem;color:' + statusColor + ';">' + statusIndicator + ' ' + status + '</span>';
            html += '</div>';
        });
        container.innerHTML = html;

        container.querySelectorAll('.char-list-item').forEach(function(el) {
            el.addEventListener('click', function() {
                var id = this.dataset.id;
                showCharacterForm(id);
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

    function addClassTag(classId, className) {
        var container = document.getElementById('class-tag-container');
        if (!container) return;
        
        var emptyMsg = container.querySelector('span[style*="text-dim"]');
        if (emptyMsg) emptyMsg.remove();
        
        var tag = document.createElement('span');
        tag.style.cssText = 'background:var(--accent-soft);padding:2px 8px;border-radius:10px;font-size:0.7rem;border:1px solid var(--accent);display:inline-flex;align-items:center;gap:4px;';
        tag.dataset.classId = classId;
        tag.innerHTML = className + ' <button class="remove-class-tag" data-id="' + classId + '" style="background:none;border:none;color:var(--danger);cursor:pointer;font-size:0.5rem;padding:0 2px;">✕</button>';
        container.appendChild(tag);
        
        tag.querySelector('.remove-class-tag').addEventListener('click', function() {
            var id = this.dataset.id;
            var container = document.getElementById('class-tag-container');
            var tag = container.querySelector('[data-class-id="' + id + '"]');
            if (tag) tag.remove();
            if (container.children.length === 0) {
                container.innerHTML = '<span style="color:var(--text-dim);font-size:0.7rem;padding:4px;">No classes assigned</span>';
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

        document.querySelectorAll('.char-tab-panel').forEach(function(p) {
            p.style.display = 'none';
            p.classList.remove('active');
        });

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

            populateFormFields(char);
            renderAcademicView(char);
            renderProfessionalView(char);
            renderSocialView(char);

            var formElement = document.getElementById('char-form');
            if (formElement) formElement.dataset.editId = editId;

            renderCharacterList();
        } else {
            title.textContent = 'New Character';
            if (nameDisplay) nameDisplay.textContent = 'New Character';
            var formElement = document.getElementById('char-form');
            if (formElement) {
                formElement.reset();
                delete formElement.dataset.editId;
            }
            resetFormFields();
            renderCharacterList();
        }

        form.style.display = 'block';
        form.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    function populateFormFields(char) {
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

        var classContainer = document.getElementById('class-tag-container');
        if (classContainer) {
            classContainer.innerHTML = '';
            var classIds = char.classIds || [];
            if (classIds.length === 0) {
                classContainer.innerHTML = '<span style="color:var(--text-dim);font-size:0.7rem;padding:4px;">No classes assigned</span>';
            } else {
                classIds.forEach(function(cid) {
                    var cls = window.getClass(cid);
                    if (cls) {
                        addClassTag(cls.id, cls.name);
                    }
                });
            }
        }

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

        var deathFields = document.getElementById('death-fields');
        if (deathFields) {
            deathFields.style.display = char.deceased ? 'block' : 'none';
        }

        // Populate academic class selector
        populateAcademicClassSelector(char);
        updateCurrentClassesDisplay(char);
    }

    function resetFormFields() {
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

        var classContainer = document.getElementById('class-tag-container');
        if (classContainer) {
            classContainer.innerHTML = '<span style="color:var(--text-dim);font-size:0.7rem;padding:4px;">No classes assigned</span>';
        }

        document.getElementById('academic-view').innerHTML = '<p class="empty-state" style="padding:8px;font-size:0.8rem;">Save character to view academic data</p>';
        document.getElementById('professional-view').innerHTML = '<p class="empty-state" style="padding:8px;font-size:0.8rem;">Save character to view professional data</p>';
        document.getElementById('social-view').innerHTML = '<p class="empty-state" style="padding:8px;font-size:0.8rem;">Save character to view social connections</p>';
        document.getElementById('standalone-eliminations-container').innerHTML = '<p class="empty-state" style="padding:6px;font-size:0.75rem;">None</p>';
        document.getElementById('tournament-eliminations-view').innerHTML = '<p class="empty-state" style="padding:6px;font-size:0.75rem;">None</p>';

        document.getElementById('physical-moves-list').innerHTML = '<p class="empty-state">None</p>';
        document.getElementById('magical-moves-list').innerHTML = '<p class="empty-state">None</p>';
        
        // Reset academic class selector
        var classSelect = document.getElementById('academic-class-select');
        if (classSelect) {
            classSelect.innerHTML = '<option value="">Select a class...</option>';
        }
        var classesDisplay = document.getElementById('current-classes-list');
        if (classesDisplay) {
            classesDisplay.textContent = 'None';
        }
    }

    // ============================================================
    // ACADEMIC TAB - CLASS MANAGEMENT
    // ============================================================

    function populateAcademicClassSelector(char) {
        var select = document.getElementById('academic-class-select');
        if (!select) return;

        var classes = window.getClasses() || [];
        var currentValue = select.value;
        select.innerHTML = '<option value="">Select a class...</option>';
        
        // Filter out classes the character is already in
        var existingClassIds = (char && char.classIds) || [];
        
        classes.forEach(function(cls) {
            var isAssigned = existingClassIds.some(function(cid) { return String(cid) === String(cls.id); });
            if (!isAssigned) {
                var option = document.createElement('option');
                option.value = cls.id;
                option.textContent = cls.name;
                select.appendChild(option);
            }
        });
        
        if (currentValue) select.value = currentValue;
    }

    function updateCurrentClassesDisplay(char) {
        var display = document.getElementById('current-classes-list');
        if (!display) return;

        var classIds = (char && char.classIds) || [];
        if (classIds.length === 0) {
            display.textContent = 'None';
            return;
        }

        var classes = window.getClasses() || [];
        var names = [];
        classIds.forEach(function(cid) {
            var cls = classes.find(function(c) { return String(c.id) === String(cid); });
            if (cls) names.push(cls.name);
        });
        display.textContent = names.length > 0 ? names.join(', ') : 'None';
    }

    function addCharacterToClass() {
        var select = document.getElementById('academic-class-select');
        if (!select) return;
        
        var classId = select.value;
        if (!classId) {
            alert('Please select a class.');
            return;
        }

        var charId = currentEditId;
        if (!charId) {
            alert('No character selected.');
            return;
        }

        var result = window.addCharacterToClass(charId, classId);
        if (result && result.success) {
            // Refresh the form
            var char = window.getCharacterById(charId);
            if (char) {
                populateFormFields(char);
                // Re-populate the class selector to remove the newly added class
                populateAcademicClassSelector(char);
                updateCurrentClassesDisplay(char);
                renderCharacterList();
            }
            alert('Character added to class successfully!');
        } else {
            alert(result ? result.message : 'Failed to add character to class.');
        }
    }

    function removeCharacterFromClass() {
        var charId = currentEditId;
        if (!charId) {
            alert('No character selected.');
            return;
        }

        var char = window.getCharacterById(charId);
        if (!char || !char.classIds || char.classIds.length === 0) {
            alert('Character is not in any classes.');
            return;
        }

        var classes = window.getClasses() || [];
        var classNames = char.classIds.map(function(cid) {
            var cls = classes.find(function(c) { return String(c.id) === String(cid); });
            return cls ? cls.name : 'Unknown';
        });

        var classList = classNames.join('\n• ');
        var choice = prompt('Enter the name of the class to remove:\n\nCurrent classes:\n• ' + classList, '');
        if (!choice) return;

        var cls = window.getClassByName(choice.trim());
        if (!cls) {
            alert('Class "' + choice + '" not found.');
            return;
        }

        var result = window.removeCharacterFromClass(charId, cls.id);
        if (result && result.success) {
            var updatedChar = window.getCharacterById(charId);
            if (updatedChar) {
                populateFormFields(updatedChar);
                populateAcademicClassSelector(updatedChar);
                updateCurrentClassesDisplay(updatedChar);
                renderCharacterList();
            }
            alert('Character removed from class successfully!');
        } else {
            alert(result ? result.message : 'Failed to remove character from class.');
        }
    }

    // ============================================================
    // ACADEMIC VIEW RENDER
    // ============================================================

    function renderAcademicView(char) {
        var container = document.getElementById('academic-view');
        if (!container) return;

        var data = window.data || {};
        var html = '';

        html += '<h4 style="color:var(--accent);font-size:0.8rem;margin:8px 0 4px 0;">Academic Teams</h4>';
        var acadTeams = data.teams ? data.teams.filter(function(t) {
            if (t.type !== 'academic') return false;
            if (t.status === 'deleted') return false;
            return t.members && t.members.some(function(m) { return String(m.characterId) === String(char.id); });
        }) : [];

        acadTeams.sort(function(a, b) {
            var aMember = a.members.find(function(m) { return String(m.characterId) === String(char.id); });
            var bMember = b.members.find(function(m) { return String(m.characterId) === String(char.id); });
            var aJoin = parseInt(aMember ? aMember.joinPeriod : 0) || 0;
            var bJoin = parseInt(bMember ? bMember.joinPeriod : 0) || 0;
            return aJoin - bJoin;
        });

        if (acadTeams.length > 0) {
            acadTeams.forEach(function(team) {
                var member = team.members.find(function(m) { return String(m.characterId) === String(char.id); });
                var period = member ? (member.joinPeriod || '?') : '?';
                if (member && member.leavePeriod) period += ' → ' + member.leavePeriod;
                var classDisplay = team.classId ? ' [' + window.getClassDisplayName(team.classId) + ']' : '';
                html += '<div style="padding:3px 8px;background:var(--bg);border-radius:4px;border-left:3px solid var(--accent);margin-bottom:3px;font-size:0.75rem;">';
                html += '<strong>' + team.name + '</strong>' + classDisplay + ' <span style="color:var(--text-dim);font-size:0.7rem;">(Wk ' + period + ')</span>';
                if (member && member.role) html += ' <span style="color:var(--text-dim);font-size:0.65rem;">[' + member.role + ']</span>';
                html += '</div>';
            });
        } else {
            html += '<p class="empty-state" style="padding:4px;font-size:0.7rem;">No academic teams</p>';
        }

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

        html += '<h4 style="color:var(--info);font-size:0.8rem;margin:8px 0 4px 0;">Professional Teams</h4>';
        var profTeams = data.teams ? data.teams.filter(function(t) {
            if (t.type !== 'professional') return false;
            if (t.status === 'deleted') return false;
            return t.members && t.members.some(function(m) { return String(m.characterId) === String(char.id); });
        }) : [];

        profTeams.sort(function(a, b) {
            var aMember = a.members.find(function(m) { return String(m.characterId) === String(char.id); });
            var bMember = b.members.find(function(m) { return String(m.characterId) === String(char.id); });
            var aJoin = parseInt(aMember ? aMember.joinPeriod : 0) || 0;
            var bJoin = parseInt(bMember ? bMember.joinPeriod : 0) || 0;
            return aJoin - bJoin;
        });

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

        html += '<h4 style="color:var(--warning);font-size:0.8rem;margin:8px 0 4px 0;">Temporary Teams</h4>';
        var tempTeams = data.teams ? data.teams.filter(function(t) {
            if (t.type !== 'temporary' && t.type !== 'internship') return false;
            if (t.status === 'deleted') return false;
            return t.members && t.members.some(function(m) { return String(m.characterId) === String(char.id); });
        }) : [];

        tempTeams.sort(function(a, b) {
            var aMember = a.members.find(function(m) { return String(m.characterId) === String(char.id); });
            var bMember = b.members.find(function(m) { return String(m.characterId) === String(char.id); });
            var aJoin = parseInt(aMember ? aMember.joinPeriod : 0) || 0;
            var bJoin = parseInt(bMember ? bMember.joinPeriod : 0) || 0;
            return aJoin - bJoin;
        });

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

        html += '<h4 style="color:var(--text-dim);font-size:0.8rem;margin:8px 0 4px 0;">Civilian Teams</h4>';
        var civTeams = data.teams ? data.teams.filter(function(t) {
            if (t.type !== 'civilian') return false;
            if (t.status === 'deleted') return false;
            return t.members && t.members.some(function(m) { return String(m.characterId) === String(char.id); });
        }) : [];

        civTeams.sort(function(a, b) {
            var aMember = a.members.find(function(m) { return String(m.characterId) === String(char.id); });
            var bMember = b.members.find(function(m) { return String(m.characterId) === String(char.id); });
            var aJoin = parseInt(aMember ? aMember.joinPeriod : 0) || 0;
            var bJoin = parseInt(bMember ? bMember.joinPeriod : 0) || 0;
            return aJoin - bJoin;
        });

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

    // ============================================================
    // CAREER STATUS FUNCTIONS
    // ============================================================

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
            <input type="number" class="career-end-year" placeholder="End Year" value="${endYear || ''}">
            <button type="button" class="small danger remove-status">✕</button>
        `;
        container.appendChild(entry);
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
                removeStandaloneElimination(char.id, parseInt(this.dataset.index));
            });
        });
    }

    function addStandaloneElimination() {
        var charId = currentEditId;
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

        if (typeof window.saveData === 'function') {
            window.saveData().then(function() {
                renderCharacterList();
                showCharacterForm(charId);
                alert('Character eliminated successfully!');
            }).catch(function(err) {
                alert('Failed to save elimination.');
            });
        } else {
            renderCharacterList();
            showCharacterForm(charId);
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

    // ============================================================
    // SAVE / DELETE CHARACTERS
    // ============================================================

    function saveCharacter(e) {
        e.preventDefault();
        var form = e.target;
        var editId = form.dataset.editId;
        var data = window.data || {};
        var isDeceased = document.getElementById('char-deceased').checked;
        var deathYear = document.getElementById('char-death-year').value.trim();
        var deathCause = document.getElementById('char-death-cause').value.trim();
        var deathAge = document.getElementById('char-death-age').value.trim();

        var classIds = [];
        document.querySelectorAll('#class-tag-container [data-class-id]').forEach(function(tag) {
            classIds.push(tag.dataset.classId);
        });

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
            classIds: classIds,
            personality: {
                traits: document.getElementById('char-traits').value.trim(),
                ideals: document.getElementById('char-ideals').value.trim(),
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
                classIds: charData.classIds,
                personality: charData.personality,
                stats: charData.stats,
                magic: charData.magic,
                specialMoves: charData.specialMoves,
                eliminations: [],
                eliminatedWeeks: [],
                createdAt: new Date().toISOString()
            };
            data.characters.push(newChar);
            currentEditId = newChar.id;
        }

        window.data = data;
        if (typeof window.saveData === 'function') {
            window.saveData().catch(function(err) { /* ignore */ });
        }
        renderCharacterList();
        if (typeof window.updateDashboardStats === 'function') {
            window.updateDashboardStats();
        }
        showCharacterForm(currentEditId);
        alert('Character saved successfully!');
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
        if (typeof window.saveData === 'function') {
            window.saveData().catch(function(err) { /* ignore */ });
        }
        currentEditId = null;
        renderCharacterList();
        if (typeof window.updateDashboardStats === 'function') {
            window.updateDashboardStats();
        }
        showCharacterForm(null);
    }

    // ============================================================
    // EVENT INITIALIZATION
    // ============================================================

    function initCharacterEvents() {
        var toggleBtn = document.getElementById('toggle-char-list');
        if (toggleBtn) {
            var newToggle = toggleBtn.cloneNode(true);
            toggleBtn.parentNode.replaceChild(newToggle, toggleBtn);
            newToggle.addEventListener('click', function(e) {
                e.stopPropagation();
                toggleCharacterList();
            });
        }

        var addBtn = document.getElementById('add-character-btn');
        if (addBtn) {
            var newAddBtn = addBtn.cloneNode(true);
            addBtn.parentNode.replaceChild(newAddBtn, addBtn);
            newAddBtn.addEventListener('click', function() {
                currentEditId = null;
                showCharacterForm(null);
                if (window.innerWidth < 768) {
                    toggleCharacterList(false);
                }
            });
        }

        var form = document.getElementById('char-form');
        if (form) {
            var newForm = form.cloneNode(true);
            form.parentNode.replaceChild(newForm, form);
            newForm.addEventListener('submit', saveCharacter);
        }

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

        document.querySelectorAll('.char-tab-btn').forEach(function(btn) {
            var newBtn = btn.cloneNode(true);
            btn.parentNode.replaceChild(newBtn, btn);
            newBtn.addEventListener('click', function() {
                var tab = this.dataset.tab;
                switchCharTab(tab);
            });
        });

        var nameFilter = document.getElementById('char-name-filter');
        if (nameFilter) {
            nameFilter.addEventListener('input', renderCharacterList);
        }
        var statusFilter = document.getElementById('char-status-filter');
        if (statusFilter) {
            statusFilter.addEventListener('change', renderCharacterList);
        }
        var classFilter = document.getElementById('char-class-filter');
        if (classFilter) {
            classFilter.addEventListener('change', renderCharacterList);
        }
        var clearFilter = document.getElementById('clear-char-filter');
        if (clearFilter) {
            clearFilter.addEventListener('click', function() {
                document.getElementById('char-name-filter').value = '';
                document.getElementById('char-status-filter').value = 'all';
                document.getElementById('char-class-filter').value = 'all';
                renderCharacterList();
            });
        }

        var addStatusBtn = document.getElementById('add-status-btn');
        if (addStatusBtn) {
            var newStatusBtn = addStatusBtn.cloneNode(true);
            addStatusBtn.parentNode.replaceChild(newStatusBtn, addStatusBtn);
            newStatusBtn.addEventListener('click', function() {
                var container = document.getElementById('career-status-container');
                addCareerStatusEntry(container);
            });
        }

        var addElimBtn = document.getElementById('add-standalone-elim-btn');
        if (addElimBtn) {
            var newElimBtn = addElimBtn.cloneNode(true);
            addElimBtn.parentNode.replaceChild(newElimBtn, addElimBtn);
            newElimBtn.addEventListener('click', addStandaloneElimination);
        }

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

        // Class tag input
        var classInput = document.getElementById('class-tag-input');
        if (classInput) {
            classInput.addEventListener('keypress', function(e) {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    var name = this.value.trim();
                    if (!name) return;
                    
                    var cls = window.getClassByName(name);
                    if (!cls) {
                        var result = window.createClass(name);
                        if (result.success) {
                            cls = result.class;
                        } else {
                            alert(result.message);
                            return;
                        }
                    }
                    
                    var container = document.getElementById('class-tag-container');
                    var existing = container.querySelector('[data-class-id="' + cls.id + '"]');
                    if (existing) {
                        alert('This class is already assigned.');
                        return;
                    }
                    
                    addClassTag(cls.id, cls.name);
                    this.value = '';
                }
            });
        }

        // Academic tab - Class management buttons
        var addToClassBtn = document.getElementById('add-to-class-btn');
        if (addToClassBtn) {
            addToClassBtn.addEventListener('click', addCharacterToClass);
        }

        var removeFromClassBtn = document.getElementById('remove-from-class-btn');
        if (removeFromClassBtn) {
            removeFromClassBtn.addEventListener('click', removeCharacterFromClass);
        }

        initStatsEvents();
        initMagicEvents();
        initSpecialMovesEvents();

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
                } else {
                    alert('Relationship functionality is not available. Please use the Social tab.');
                }
            });
        }

        document.addEventListener('click', function(e) {
            var panel = document.getElementById('char-list-panel');
            var toggle = document.getElementById('toggle-char-list');
            if (panel && panel.classList.contains('open')) {
                if (!panel.contains(e.target) && !toggle.contains(e.target)) {
                    toggleCharacterList(false);
                }
            }
        });

        populateClassSelect();
    }

    // ============================================================
    // STATS EVENTS - FIXED
    // ============================================================

    function initStatsEvents() {
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
            populateClassSelect();
            classSelect.addEventListener('change', function() {
                var display = document.getElementById('suggested-class');
                var descDisplay = document.getElementById('class-description-display');
                
                if (this.value) {
                    var classes = window.CLASS_DEFINITIONS || [];
                    var selected = classes.find(function(c) { return c.id === this.value; }.bind(this));
                    if (selected) {
                        display.textContent = (selected.icon || '') + ' ' + (selected.label || '');
                        display.style.color = 'var(--accent)';
                        display.style.background = 'var(--accent-soft)';
                        display.style.borderColor = 'var(--accent)';
                        if (descDisplay) {
                            descDisplay.textContent = selected.description || 'No description available.';
                            descDisplay.style.borderLeftColor = 'var(--accent)';
                            descDisplay.style.color = 'var(--text)';
                        }
                    }
                } else {
                    updateClassSuggestion();
                    if (descDisplay) {
                        descDisplay.textContent = 'Select a class to see its description here.';
                        descDisplay.style.borderLeftColor = 'var(--accent)';
                        descDisplay.style.color = 'var(--text-dim)';
                    }
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
    }

    function populateClassSelect() {
        var select = document.getElementById('manual-class-select');
        if (!select) {
            return;
        }
        
        var classes = window.CLASS_DEFINITIONS || [];
        var currentValue = select.value || '';
        
        select.innerHTML = '<option value="">Auto-suggest</option>';
        
        classes.forEach(function(cls) {
            if (cls && cls.id) {
                var option = document.createElement('option');
                option.value = cls.id;
                option.textContent = (cls.icon || '') + ' ' + (cls.label || cls.id);
                select.appendChild(option);
            }
        });
        
        if (currentValue) {
            var optionExists = false;
            for (var i = 0; i < select.options.length; i++) {
                if (select.options[i].value === currentValue) {
                    optionExists = true;
                    break;
                }
            }
            if (optionExists) {
                select.value = currentValue;
            }
        }
    }

    function updateClassSuggestion() {
        var str = parseInt(document.getElementById('char-str') ? document.getElementById('char-str').value : 10) || 10;
        var dex = parseInt(document.getElementById('char-dex') ? document.getElementById('char-dex').value : 10) || 10;
        var con = parseInt(document.getElementById('char-con') ? document.getElementById('char-con').value : 10) || 10;
        var int = parseInt(document.getElementById('char-int') ? document.getElementById('char-int').value : 10) || 10;
        var wis = parseInt(document.getElementById('char-wis') ? document.getElementById('char-wis').value : 10) || 10;
        var cha = parseInt(document.getElementById('char-cha') ? document.getElementById('char-cha').value : 10) || 10;

        var stats = { str: str, dex: dex, con: con, int: int, wis: wis, cha: cha };
        
        if (typeof window.suggestClass !== 'function') {
            return;
        }
        
        var suggested = window.suggestClass(stats);
        var display = document.getElementById('suggested-class');
        var descDisplay = document.getElementById('class-description-display');

        if (display) {
            if (suggested) {
                display.textContent = (suggested.icon || '') + ' ' + (suggested.label || '');
                display.style.color = 'var(--accent)';
                display.style.background = 'var(--accent-soft)';
                display.style.borderColor = 'var(--accent)';
                if (descDisplay && suggested.description) {
                    descDisplay.textContent = suggested.description;
                    descDisplay.style.borderLeftColor = 'var(--accent)';
                    descDisplay.style.color = 'var(--text)';
                }
            } else {
                display.textContent = '—';
                display.style.color = 'var(--text-dim)';
                display.style.background = 'transparent';
                display.style.borderColor = 'var(--border)';
                if (descDisplay) {
                    descDisplay.textContent = 'No class suggested based on current stats.';
                    descDisplay.style.borderLeftColor = 'var(--border)';
                    descDisplay.style.color = 'var(--text-dim)';
                }
            }
        }
    }

    // ============================================================
    // MAGIC EVENTS
    // ============================================================

    function initMagicEvents() {
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
                display.textContent = '—';
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
        var filled = '●';
        var empty = '○';
        var display = '';
        for (var i = 0; i < 5; i++) {
            display += (i <= level) ? filled : empty;
        }

        var el = document.getElementById('magic-power-display-text');
        if (el) {
            el.textContent = display + ' (' + total + '/' + maxPower + ')';
        }
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

    // ============================================================
    // SPECIAL MOVES FUNCTIONS
    // ============================================================

    function initSpecialMovesEvents() {
        var addPhysicalBtn = document.getElementById('add-physical-move-btn');
        if (addPhysicalBtn) {
            addPhysicalBtn.addEventListener('click', function() {
                var form = document.getElementById('char-form');
                var editId = form ? form.dataset.editId : null;
                if (!editId) {
                    alert('Please save the character first.');
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
                    alert('Please save the character first.');
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

    function renderSpecialMoves(containerId, moves, type) {
        var container = document.getElementById(containerId);
        if (!container) return;

        if (!moves || moves.length === 0) {
            container.innerHTML = '<p class="empty-state" style="padding:4px;font-size:0.7rem;">None</p>';
            return;
        }

        var html = '';
        var color = type === 'physical' ? 'var(--accent)' : 'var(--info)';
        moves.forEach(function(move, index) {
            html += '<div class="special-move-entry" style="border-left-color:' + color + ';">';
            html += '<div><span class="move-name">' + move.name + '</span> <span class="move-desc">' + (move.description || '') + '</span></div>';
            html += '<button class="remove-special-move small" style="background:none;border:none;color:var(--danger);cursor:pointer;font-size:0.5rem;padding:0 2px;" data-type="' + type + '" data-index="' + index + '">✕</button>';
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

    // ============================================================
    // REGISTER WITH TABMANAGER
    // ============================================================

    if (typeof window.TabManager !== 'undefined') {
        window.TabManager.register('characters', renderCharacters);
    }

    document.addEventListener('dataReady', function() {
        var container = document.getElementById('tab-characters');
        if (container && container.style.display !== 'none') {
            renderCharacters(container);
        }
    });

    document.addEventListener('tabChanged', function(e) {
        if (e.detail && e.detail.tab === 'characters') {
            var container = document.getElementById('tab-characters');
            if (container) {
                renderCharacters(container);
            }
        }
    });

    if (window.data) {
        setTimeout(function() {
            var container = document.getElementById('tab-characters');
            if (container && container.style.display !== 'none') {
                renderCharacters(container);
            }
        }, 100);
    }

    window.renderCharacters = renderCharacters;
    window.showCharacterForm = showCharacterForm;
    window.renderCharacterList = renderCharacterList;
    window.switchCharTab = switchCharTab;

})();
