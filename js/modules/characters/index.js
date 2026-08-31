/**
 * modules/characters/index.js - Characters Module Entry Point
 * Single entry point for all character functionality
 * Path: js/modules/characters/index.js
 * 
 * This module is responsible for:
 *   - Registering with TabManager
 *   - Rendering the character container
 *   - Initializing all character sub-modules
 *   - Managing character lifecycle
 * 
 * LIFECYCLE:
 *   TabManager registers 'characters' → renderCharacters() → 
 *   CharacterList.render() → CharacterForm.init() → CharacterEvents.init()
 * 
 * IMPORTANT:
 *   - This module is the only external entry point for characters
 *   - All character logic lives in the sub-modules
 *   - This module does NOT implement character logic directly
 *   - It delegates to sub-modules for all operations
 * 
 * DEPENDENCIES:
 *   - window.CharacterList (from character-list.js)
 *   - window.CharacterForm (from character-form.js)
 *   - window.CharacterEvents (from character-events.js)
 *   - window.CharacterCRUD (from character-crud.js)
 *   - window.CharacterClasses (from character-classes.js)
 *   - window.CharacterEliminations (from character-eliminations.js)
 *   - window.CharacterViews (from character-views.js)
 *   - window.CharacterStats (from character-stats.js)
 *   - window.CharacterDetail (from character-detail.js)
 *   - window.TabManager (from tab-manager.js)
 */

(function() {
    'use strict';

    // Guard against duplicate loading
    if (window.__charactersModuleLoaded) {
        return;
    }
    window.__charactersModuleLoaded = true;

    // ============================================================
    // STATE - Single source of truth for character edit state
    // ============================================================
    
    // Use a module-scoped variable instead of calling itself
    var _currentEditId = null;

    // ============================================================
    // DEPENDENCY CHECK
    // ============================================================

    function checkDependencies() {
        var required = [
            'CharacterList',
            'CharacterForm',
            'CharacterEvents',
            'CharacterCRUD',
            'CharacterClasses',
            'CharacterEliminations',
            'CharacterViews',
            'CharacterStats',
            'CharacterDetail'
        ];

        var missing = [];
        required.forEach(function(name) {
            if (typeof window[name] === 'undefined' || window[name] === null) {
                missing.push(name);
            }
        });

        if (missing.length > 0) {
            console.warn('CharactersModule: Missing dependencies:', missing.join(', '));
            return false;
        }

        return true;
    }

    // ============================================================
    // RENDER FUNCTION
    // ============================================================

    function renderCharacters(container) {
        if (!container) {
            container = document.getElementById('tab-characters');
        }

        if (!container) {
            console.warn('CharactersModule: Container not found');
            return;
        }

        if (!window.data) {
            container.innerHTML = '<p class="empty-state">Loading character data...</p>';
            return;
        }

        if (!checkDependencies()) {
            container.innerHTML = '<p class="empty-state">Character dependencies not loaded. Please refresh the page.</p>';
            return;
        }

        // Render the character container
        container.innerHTML = getCharactersHTML();

        // Initialize character list
        if (window.CharacterList && typeof window.CharacterList.render === 'function') {
            window.CharacterList.render();
        }

        // Initialize character form
        if (window.CharacterForm && typeof window.CharacterForm.init === 'function') {
            window.CharacterForm.init(container);
        }

        // Initialize character events
        if (window.CharacterEvents && typeof window.CharacterEvents.init === 'function') {
            window.CharacterEvents.init(container);
        }

        // Show the current character if any
        var editId = getCurrentEditId();
        if (editId && window.CharacterForm && typeof window.CharacterForm.show === 'function') {
            window.CharacterForm.show(editId);
        }

        console.log('CharactersModule: Rendered successfully');
    }

    // ============================================================
    // CHARACTERS HTML
    // ============================================================

    function getCharactersHTML() {
        return `
            <div class="characters-layout">
                <div class="characters-sidebar">
                    <div class="characters-header">
                        <h2>Characters</h2>
                        <div class="characters-header-actions">
                            <button id="toggle-char-list" class="secondary small" aria-label="Toggle character list">☰</button>
                            <button id="add-character-btn" class="primary small">+ Add</button>
                        </div>
                    </div>
                    <div class="characters-filters">
                        <input type="text" id="char-name-filter" placeholder="Filter by name..." />
                        <select id="char-status-filter">
                            <option value="all">All Statuses</option>
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
                        <select id="char-class-filter">
                            <option value="all">All Classes</option>
                        </select>
                        <button id="clear-char-filter" class="small secondary">Clear</button>
                    </div>
                    <div id="char-list-panel">
                        <div id="characters-container"></div>
                    </div>
                </div>
                <div class="characters-form-container">
                    <div id="character-form-container">
                        ${getCharacterFormHTML()}
                    </div>
                </div>
            </div>
        `;
    }

    // ============================================================
    // CHARACTER FORM HTML
    // ============================================================

    function getCharacterFormHTML() {
        return `
            <form id="character-form" style="display:none;">
                <div class="form-header">
                    <h3 id="form-title">New Character</h3>
                    <span id="current-char-name" class="char-name-display"></span>
                    <div class="form-actions">
                        <button type="button" id="delete-char-btn" class="danger small">Delete</button>
                        <button type="submit" id="save-char-btn" class="primary">Save</button>
                    </div>
                </div>
                
                <!-- Tabs -->
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

                <!-- Name Tab -->
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
                            <div id="death-fields" class="death-fields" style="display:none;">
                                <div class="form-group">
                                    <label>Year of Death</label>
                                    <input type="number" id="char-death-year" placeholder="e.g., 2023" />
                                </div>
                                <div class="form-group">
                                    <label>Death Age</label>
                                    <input type="number" id="char-death-age" min="0" max="150" placeholder="e.g., 45" />
                                </div>
                                <div class="form-group">
                                    <label>Death Week (1-52)</label>
                                    <input type="number" id="char-death-week" min="1" max="52" placeholder="e.g., 24" />
                                </div>
                                <div class="form-group full-width">
                                    <label>Cause of Death</label>
                                    <input type="text" id="char-death-cause" />
                                </div>
                            </div>
                        </div>
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

                <!-- Physical Tab -->
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
                            <input type="text" id="char-height" placeholder="e.g., 5'10\"" />
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
                        <div class="form-group full-width section-divider">
                            <label>Attraction</label>
                            <input type="text" id="char-attraction" placeholder="Women, Men, All, None, Other" />
                        </div>
                        <div class="form-group full-width">
                            <label>Sexuality</label>
                            <input type="text" id="char-sexuality" placeholder="Heterosexual, Homosexual, Bisexual, Pansexual, Asexual, Questioning, Other" />
                        </div>
                    </div>
                </div>

                <!-- Personality Tab -->
                <div id="char-tab-personality" class="char-tab-panel" style="display:none;">
                    <div class="personality-grid" style="display:grid;grid-template-columns:1fr 1fr;gap:4px;">
                        <div class="form-group"><label>Traits</label><input type="text" id="char-traits" placeholder="Brave, Honest, Curious..." /></div>
                        <div class="form-group"><label>Ideals</label><input type="text" id="char-ideals" placeholder="Justice, Freedom, Truth..." /></div>
                        <div class="form-group"><label>Bonds</label><input type="text" id="char-bonds" placeholder="Family, Country, Friends..." /></div>
                        <div class="form-group"><label>Flaws</label><input type="text" id="char-flaws" placeholder="Fear, Pride, Greed..." /></div>
                        <div class="form-group"><label>Alignment</label><input type="text" id="char-alignment" placeholder="Lawful Good, Chaotic Neutral..." /></div>
                        <div class="form-group"><label>Likes</label><input type="text" id="char-likes" placeholder="Music, Books, Combat..." /></div>
                        <div class="form-group"><label>Dislikes</label><input type="text" id="char-dislikes" placeholder="Lies, Injustice, Spiders..." /></div>
                        <div class="form-group"><label>Habits</label><input type="text" id="char-habits" placeholder="Smoking, Pacing, Humming..." /></div>
                        <div class="form-group"><label>Fears</label><input type="text" id="char-fears" placeholder="Heights, Loss, Darkness..." /></div>
                        <div class="form-group"><label>Goals</label><input type="text" id="char-goals" placeholder="Seeking power, Revenge, Peace..." /></div>
                    </div>
                </div>

                <!-- Academic Tab -->
                <div id="char-tab-academic" class="char-tab-panel" style="display:none;">
                    <div id="academic-view" style="padding:4px 0;">
                        <p class="empty-state" style="padding:8px;font-size:0.8rem;">Loading academic data...</p>
                    </div>
                    <div class="form-group full-width section-divider">
                        <label class="section-label">Class Management</label>
                        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:4px;">
                            <select id="academic-class-select" style="flex:1;min-width:150px;padding:6px;background:var(--panel-alt);border:1px solid var(--border);color:var(--text);border-radius:6px;">
                                <option value="">Select a class...</option>
                            </select>
                            <button type="button" id="add-to-class-btn" class="primary small">Add to Class</button>
                            <button type="button" id="remove-from-class-btn" class="danger small">Remove from Class</button>
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

                <!-- Professional Tab -->
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

                <!-- Stats Tab -->
                <div id="char-tab-stats" class="char-tab-panel" style="display:none;">
                    ${window.CharacterStats && typeof window.CharacterStats.getStatsTabHTML === 'function' 
                        ? window.CharacterStats.getStatsTabHTML() 
                        : '<p class="empty-state">Stats module not loaded</p>'}
                </div>

                <!-- Social Tab -->
                <div id="char-tab-social" class="char-tab-panel" style="display:none;">
                    <div id="social-view">
                        <p class="empty-state" style="padding:8px;font-size:0.8rem;">Loading social connections...</p>
                    </div>
                    <div class="form-actions" style="margin-top:8px;">
                        <button type="button" id="add-social-relation-btn" class="primary small">+ Add Connection</button>
                    </div>
                </div>

                <!-- Notes Tab -->
                <div id="char-tab-notes" class="char-tab-panel" style="display:none;">
                    <div class="form-group full-width">
                        <textarea id="char-notes" rows="6" placeholder="Background, motivations, history..." style="min-height:150px;"></textarea>
                    </div>
                </div>
            </form>
        `;
    }

    // ============================================================
    // STATE MANAGEMENT - Using module-scoped variable (no recursion)
    // ============================================================

    /**
     * Get the current edit ID from the module state
     */
    function getCurrentEditId() {
        return _currentEditId;
    }

    /**
     * Set the current edit ID in the module state
     */
    function setCurrentEditId(id) {
        _currentEditId = id;
    }

    /**
     * Show the character form for a specific character
     */
    function showCharacterForm(id) {
        setCurrentEditId(id);
        if (window.CharacterForm && typeof window.CharacterForm.show === 'function') {
            window.CharacterForm.show(id);
        }
    }

    /**
     * Toggle the character list panel
     */
    function toggleCharacterList(forceState) {
        var panel = document.getElementById('char-list-panel');
        if (!panel) return;

        if (forceState !== undefined) {
            panel.classList.toggle('open', forceState);
        } else {
            panel.classList.toggle('open');
        }
    }

    // ============================================================
    // REGISTER WITH TABMANAGER
    // ============================================================

    // Register immediately if TabManager is available
    if (window.TabManager && typeof window.TabManager.register === 'function') {
        window.TabManager.register('characters', renderCharacters);
        console.log('CharactersModule: Registered with TabManager');
    } else {
        // TabManager not ready yet - wait for it
        document.addEventListener('DOMContentLoaded', function() {
            if (window.TabManager && typeof window.TabManager.register === 'function') {
                window.TabManager.register('characters', renderCharacters);
                console.log('CharactersModule: Registered with TabManager (delayed)');
            }
        });
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    // Main render function
    window.renderCharacters = renderCharacters;

    // State management (using module-scoped variable)
    window.getCurrentEditId = getCurrentEditId;
    window.setCurrentEditId = setCurrentEditId;
    window.showCharacterForm = showCharacterForm;
    window.toggleCharacterList = toggleCharacterList;

    // ============================================================
    // LIFECYCLE EVENTS
    // ============================================================

    // When data is ready, render the characters tab if it's visible
    document.addEventListener('dataReady', function() {
        var container = document.getElementById('tab-characters');
        if (container && container.style.display !== 'none') {
            renderCharacters(container);
        }
    });

    // When tab changes, render or save state
    document.addEventListener('tabChanged', function(e) {
        if (!e || !e.detail) {
            return;
        }

        if (e.detail.tab === 'characters') {
            var container = document.getElementById('tab-characters');
            if (container) {
                renderCharacters(container);
            }
        }
    });

    // ============================================================
    // AUTO-INITIALIZE IF DATA ALREADY AVAILABLE
    // ============================================================

    if (window.data) {
        setTimeout(function() {
            var container = document.getElementById('tab-characters');
            if (container && container.style.display !== 'none') {
                renderCharacters(container);
            }
        }, 100);
    }

})();
