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
 * IMPORTANT:
 *   - All user-controlled data is escaped to prevent XSS.
 *   - Search input is debounced to prevent excessive re-renders.
 *   - Filters are applied in a pure function for testability.
 *   - The list is re-rendered when data changes.
 * 
 * DEPENDENCIES:
 *   - window.getCharacterById (from core-utils.js)
 *   - window.getDisplayName (from core-utils.js)
 *   - window.getFullName (from core-utils.js)
 *   - window.getCurrentStatus (from core-utils.js)
 *   - window.getClasses (from core-utils.js)
 *   - window.currentEditId (from index.js)
 *   - window.showCharacterForm (from index.js)
 *   - window.toggleCharacterList (from index.js)
 */

(function() {
    'use strict';

    // Guard against duplicate script loading
    if (window.__characterListLoaded) {
        return;
    }
    window.__characterListLoaded = true;

    // ============================================================
    // CONSTANTS
    // ============================================================

    var DEBOUNCE_DELAY = 300;

    // ============================================================
    // DEPENDENCY CHECK
    // ============================================================

    function checkDependencies() {
        var required = [
            'getCharacterById',
            'getDisplayName',
            'getFullName',
            'getCurrentStatus',
            'getClasses',
            'currentEditId',
            'showCharacterForm',
            'toggleCharacterList'
        ];

        var missing = [];
        required.forEach(function(name) {
            if (name === 'currentEditId' && typeof window.currentEditId !== 'function') {
                missing.push('currentEditId');
            } else if (name === 'showCharacterForm' && typeof window.showCharacterForm !== 'function') {
                missing.push('showCharacterForm');
            } else if (name === 'toggleCharacterList' && typeof window.toggleCharacterList !== 'function') {
                missing.push('toggleCharacterList');
            } else if (typeof window[name] !== 'function' && 
                       name !== 'currentEditId' &&
                       name !== 'showCharacterForm' &&
                       name !== 'toggleCharacterList') {
                missing.push(name);
            }
        });

        if (missing.length > 0) {
            console.warn('CharacterList: Missing dependencies:', missing.join(', '));
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
            var classes = typeof window.getClasses === 'function'
                ? window.getClasses()
                : [];
            char.classIds.forEach(function(cid) {
                var cls = classes.find(function(c) {
                    return c && String(c.id) === String(cid);
                });
                if (cls) names.push(cls.name);
            });
        }
        return names;
    }

    // ============================================================
    // FILTER FUNCTIONS - PURE
    // ============================================================

    function applyFilters(char, nameFilter, statusFilter, classFilter) {
        // Name filter
        if (nameFilter) {
            var displayName = String(typeof window.getDisplayName === 'function'
                ? window.getDisplayName(char)
                : char.firstName || '').toLowerCase();
            var fullName = String(typeof window.getFullName === 'function'
                ? window.getFullName(char)
                : '').toLowerCase();
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
                var status = String(typeof window.getCurrentStatus === 'function'
                    ? window.getCurrentStatus(char)
                    : '').toLowerCase();
                // Exact match or starts with (for "(Former)" suffix)
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
    // POPULATE CLASS FILTER
    // ============================================================

    function populateClassFilter() {
        var select = document.getElementById('char-class-filter');
        if (!select) return;

        var classes = typeof window.getClasses === 'function'
            ? window.getClasses()
            : [];

        var currentValue = select.value || 'all';

        // Preserve current value if it still exists
        var exists = false;
        for (var i = 0; i < classes.length; i++) {
            if (String(classes[i].id) === String(currentValue)) {
                exists = true;
                break;
            }
        }

        // Rebuild options
        select.innerHTML = '<option value="all">All Classes</option>';
        classes.forEach(function(cls) {
            var option = document.createElement('option');
            option.value = cls.id;
            option.textContent = cls.name;
            select.appendChild(option);
        });

        select.value = exists ? currentValue : 'all';
    }

    // ============================================================
    // RENDER CHARACTER LIST
    // ============================================================

    function render() {
        if (!checkDependencies()) {
            var listContainer = document.getElementById('characters-container');
            if (listContainer) {
                listContainer.innerHTML = '<p class="empty-state" style="padding:10px;font-size:0.8rem;">Dependencies not loaded. Please refresh the page.</p>';
            }
            return;
        }

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
                var nameA = String(typeof window.getDisplayName === 'function'
                    ? window.getDisplayName(a)
                    : a.firstName || '').toLowerCase();
                var nameB = String(typeof window.getDisplayName === 'function'
                    ? window.getDisplayName(b)
                    : b.firstName || '').toLowerCase();
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
            var displayName = typeof window.getDisplayName === 'function'
                ? window.getDisplayName(char)
                : char.firstName || 'Unknown';
            var status = typeof window.getCurrentStatus === 'function'
                ? window.getCurrentStatus(char)
                : '';
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
    // GET FILTER VALUES
    // ============================================================

    function getFilterValues() {
        return {
            nameFilter: document.getElementById('char-name-filter')
                ? document.getElementById('char-name-filter').value.toLowerCase()
                : '',
            statusFilter: document.getElementById('char-status-filter')
                ? document.getElementById('char-status-filter').value
                : 'all',
            classFilter: document.getElementById('char-class-filter')
                ? document.getElementById('char-class-filter').value
                : 'all'
        };
    }

    // ============================================================
    // GET CURRENTLY SELECTED CHARACTER ID
    // ============================================================

    function getSelectedCharacterId() {
        var activeItem = document.querySelector('.char-list-item.active');
        return activeItem ? activeItem.dataset.id : null;
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.CharacterList = {
        render: render,
        applyFilters: applyFilters,
        populateClassFilter: populateClassFilter,
        getFilterValues: getFilterValues,
        getSelectedCharacterId: getSelectedCharacterId,
        DEBOUNCE_DELAY: DEBOUNCE_DELAY
    };

})();
