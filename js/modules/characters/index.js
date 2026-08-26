/**
 * js/modules/characters/index.js - Character Module Entry Point
 * Path: js/modules/characters/index.js
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
        
        window.CharacterList.render(container);
        window.CharacterForm.init(container);
        window.CharacterEvents.init(container);
        
        if (window.data.characters && window.data.characters.length > 0) {
            var firstChar = window.data.characters[0];
            if (firstChar) {
                window.CharacterForm.show(firstChar.id);
            }
        }
        window.CharacterStats.updateClassSuggestion();
        window.CharacterStats.updateMagicClassSuggestion();
        window.CharacterStats.updateMagicPowerDisplay();
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
                        ${window.CharacterForm.getTabsHTML()}
                        <div class="form-actions" style="margin-top:12px;border-top:1px solid var(--border-soft);padding-top:12px;">
                            <button type="button" id="delete-char-btn" class="danger">Delete</button>
                            <button type="submit" id="save-char-btn" class="primary">Save Character</button>
                        </div>
                    </form>
                </div>
            </div>
        `;
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

    function showCharacterForm(editId) {
        window.CharacterForm.show(editId);
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

    // ============================================================
    // EXPOSE FUNCTIONS
    // ============================================================

    window.renderCharacters = renderCharacters;
    window.showCharacterForm = showCharacterForm;
    window.toggleCharacterList = toggleCharacterList;
    window.currentEditId = function() { return currentEditId; };
    window.setCurrentEditId = function(id) { currentEditId = id; };

})();
