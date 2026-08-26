/**
 * js/modules/characters/character-list.js - Character List
 * Path: js/modules/characters/character-list.js
 */

(function() {
    'use strict';

    // Guard against duplicate script loading
    if (window.__characterListLoaded) {
        return;
    }
    window.__characterListLoaded = true;

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

    function render(container) {
        var listContainer = document.getElementById('characters-container');
        if (!listContainer) return;

        populateClassFilter();

        var statusFilter = document.getElementById('char-status-filter') ? document.getElementById('char-status-filter').value : 'all';
        var nameFilter = document.getElementById('char-name-filter') ? document.getElementById('char-name-filter').value.toLowerCase() : '';
        var classFilter = document.getElementById('char-class-filter') ? document.getElementById('char-class-filter').value : 'all';

        var data = window.data || {};
        if (!data.characters || data.characters.length === 0) {
            listContainer.innerHTML = '<p class="empty-state" style="padding:10px;font-size:0.8rem;">No characters. Create one!</p>';
            return;
        }

        var filteredChars = data.characters
            .filter(function(char) {
                return applyFilters(char, nameFilter, statusFilter, classFilter);
            })
            .sort(function(a, b) {
                var nameA = window.getDisplayName(a).toLowerCase();
                var nameB = window.getDisplayName(b).toLowerCase();
                return nameA.localeCompare(nameB);
            });

        if (filteredChars.length === 0) {
            listContainer.innerHTML = '<p class="empty-state" style="padding:10px;font-size:0.8rem;">No matches</p>';
            return;
        }

        var currentId = typeof window.currentEditId === 'function'
            ? window.currentEditId()
            : null;

        var html = '';
        filteredChars.forEach(function(char) {
            var displayName = window.getDisplayName(char);
            var status = window.getCurrentStatus(char);
            var isDead = char.deceased || false;
            var deadMarker = isDead ? ' ✝' : '';
            var isActive = String(char.id) === String(currentId);
            var activeClass = isActive ? ' active' : '';
            
            var statusIndicator = getStatusIndicator(status);
            var statusColor = getStatusColor(status);

            var classNames = getCharacterClassNames(char);
            var classDisplay = classNames.length > 0 ? ' [' + classNames.join(', ') + ']' : '';

            html += '<div class="char-list-item' + activeClass + '" data-id="' + escapeHtml(char.id) + '">';
            html += '<span class="char-name">' + escapeHtml(displayName) + deadMarker + escapeHtml(classDisplay) + '</span>';
            html += '<span class="char-status" style="font-size:0.6rem;color:' + statusColor + ';">' + statusIndicator + ' ' + escapeHtml(status) + '</span>';
            html += '</div>';
        });
        listContainer.innerHTML = html;

        listContainer.querySelectorAll('.char-list-item').forEach(function(el) {
            el.addEventListener('click', function() {
                var id = this.dataset.id;
                if (typeof window.showCharacterForm === 'function') {
                    window.showCharacterForm(id);
                }
                if (window.innerWidth < 768) {
                    if (typeof window.toggleCharacterList === 'function') {
                        window.toggleCharacterList(false);
                    }
                }
            });
        });
    }

    // ... (applyFilters, populateClassFilter, getStatusIndicator, getStatusColor, getCharacterClassNames remain the same)

    // ============================================================
    // EXPOSE
    // ============================================================

    window.CharacterList = {
        render: render,
        applyFilters: applyFilters,
        populateClassFilter: populateClassFilter
    };

})();
