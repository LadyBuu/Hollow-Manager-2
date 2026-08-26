/**
 * js/modules/characters/character-list.js - Character List
 * Renders and filters the character list with search and filtering
 * Path: js/modules/characters/character-list.js
 * 
 * This module is responsible for:
 *   - Rendering the character list
 *   - Filtering by name, status, and class
 *   - Highlighting the currently selected character
 *   - Populating the class filter dropdown
 * 
 * IMPORTANT: All user-controlled data is escaped to prevent XSS.
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

    // ============================================================
    // RENDER CHARACTER LIST
    // ============================================================

    function render() {
        var listContainer = document.getElementById('characters-container');
        if (!listContainer) return;

        // Populate filter BEFORE reading values
        populateClassFilter();

        var statusFilter = document.getElementById('char-status-filter') 
            ? document.getElementById('char-status-filter').value 
            : 'all';
        var nameFilter = document.getElementById('char-name-filter') 
            ? document.getElementById('char-name-filter').value.toLowerCase() 
            : '';
        var classFilter = document.getElementById('char-class-filter') 
            ? document.getElementById('char-class-filter').value 
            : 'all';

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
                var nameA = String(window.getDisplayName(a) || '').toLowerCase();
                var nameB = String(window.getDisplayName(b) || '').toLowerCase();
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

        // Attach click listeners to list items
        listContainer.querySelectorAll('.char-list-item').forEach(function(el) {
            el.addEventListener('click', function() {
                var id = this.dataset.id;
                if (typeof window.showCharacterForm === 'function') {
                    window.showCharacterForm(id);
                }
                // Close list on mobile
                if (window.innerWidth < 768) {
                    if (typeof window.toggleCharacterList === 'function') {
                        window.toggleCharacterList(false);
                    }
                }
            });
        });
    }

    // ============================================================
    // FILTER FUNCTIONS
    // ============================================================

    function applyFilters(char, nameFilter, statusFilter, classFilter) {
        // Name filter
        if (nameFilter) {
            var displayName = String(window.getDisplayName(char) || '').toLowerCase();
            var fullName = String(window.getFullName(char) || '').toLowerCase();
            if (displayName.indexOf(nameFilter) === -1 && fullName.indexOf(nameFilter) === -1) {
                return false;
            }
        }

        // Status filter
        if (statusFilter !== 'all') {
            if (statusFilter === 'deceased') {
                if (!char.deceased) return false;
            } else if (statusFilter === 'eliminated') {
                var hasElimination = char.eliminations && char.eliminations.length > 0;
                if (!hasElimination) return false;
            } else {
                var status = String(window.getCurrentStatus(char) || '').toLowerCase();
                if (status !== statusFilter && !status.startsWith(statusFilter + ' ')) {
                    return false;
                }
            }
        }

        // Class filter
        if (classFilter !== 'all') {
            if (!char.classIds || !char.classIds.some(function(cid) { 
                return String(cid) === String(classFilter); 
            })) {
                return false;
            }
        }

        return true;
    }

    // ============================================================
    // CLASS FILTER POPULATION - Fixed stale selection
    // ============================================================

    function populateClassFilter() {
        var select = document.getElementById('char-class-filter');
        if (!select) return;

        // Defensive: ensure getClasses exists and returns an array
        var classes = typeof window.getClasses === 'function'
            ? window.getClasses()
            : [];
        
        var currentValue = select.value;
        
        select.innerHTML = '<option value="all">All Classes</option>';
        classes.forEach(function(cls) {
            var option = document.createElement('option');
            option.value = cls.id;
            option.textContent = cls.name;
            select.appendChild(option);
        });
        
        // Check if current value still exists as an option
        var exists = Array.from(select.options).some(function(option) {
            return option.value === currentValue;
        });
        
        select.value = exists ? currentValue : 'all';
    }

    // ============================================================
    // STATUS HELPERS
    // ============================================================

    function getStatusIndicator(status) {
        var statusLower = String(status || '').toLowerCase();
        if (statusLower === 'trainee' || statusLower === 'rookie') return '▸';
        if (statusLower === 'junior' || statusLower === 'senior') return '◆';
        if (statusLower === 'instructor') return '◇';
        if (statusLower === 'support') return '◈';
        if (statusLower === 'civilian') return '○';
        return '';
    }

    function getStatusColor(status) {
        var statusLower = String(status || '').toLowerCase();
        if (statusLower === 'trainee' || statusLower === 'rookie') return 'var(--accent)';
        if (statusLower === 'junior' || statusLower === 'senior') return 'var(--warning)';
        if (statusLower === 'instructor' || statusLower === 'support') return 'var(--info)';
        if (statusLower === 'civilian') return 'var(--text-dim)';
        return 'var(--text-dim)';
    }

    // ============================================================
    // CHARACTER CLASS NAME HELPER
    // ============================================================

    function getCharacterClassNames(char) {
        var names = [];
        if (char.classIds && char.classIds.length > 0) {
            // Defensive: ensure getClasses exists and returns an array
            var classes = typeof window.getClasses === 'function'
                ? window.getClasses()
                : [];
            char.classIds.forEach(function(cid) {
                var cls = classes.find(function(c) { 
                    return String(c.id) === String(cid); 
                });
                if (cls) names.push(cls.name);
            });
        }
        return names;
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.CharacterList = {
        render: render,
        applyFilters: applyFilters,
        populateClassFilter: populateClassFilter
    };

})();
