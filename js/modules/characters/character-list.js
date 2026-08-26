/**
 * js/modules/characters/character-list.js - Character List
 * Path: js/modules/characters/character-list.js
 */

(function() {
    'use strict';

    function render(container) {
        var listContainer = document.getElementById('characters-container');
        if (!listContainer) return;

        var data = window.data || {};
        if (!data.characters || data.characters.length === 0) {
            listContainer.innerHTML = '<p class="empty-state" style="padding:10px;font-size:0.8rem;">No characters. Create one!</p>';
            return;
        }

        var statusFilter = document.getElementById('char-status-filter') ? document.getElementById('char-status-filter').value : 'all';
        var nameFilter = document.getElementById('char-name-filter') ? document.getElementById('char-name-filter').value.toLowerCase() : '';
        var classFilter = document.getElementById('char-class-filter') ? document.getElementById('char-class-filter').value : 'all';

        populateClassFilter();

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

        // FIX: Get current ID correctly
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

            html += '<div class="char-list-item' + activeClass + '" data-id="' + char.id + '">';
            html += '<span class="char-name">' + displayName + deadMarker + classDisplay + '</span>';
            html += '<span class="char-status" style="font-size:0.6rem;color:' + statusColor + ';">' + statusIndicator + ' ' + status + '</span>';
            html += '</div>';
        });
        listContainer.innerHTML = html;

        listContainer.querySelectorAll('.char-list-item').forEach(function(el) {
            el.addEventListener('click', function() {
                var id = this.dataset.id;
                window.showCharacterForm(id);
                if (window.innerWidth < 768) {
                    window.CharacterEvents.toggleCharacterList(false);
                }
            });
        });
    }

    function applyFilters(char, nameFilter, statusFilter, classFilter) {
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
    }

    function populateClassFilter() {
        var select = document.getElementById('char-class-filter');
        if (!select) return;

        var classes = window.getClasses();
        var currentValue = select.value;
        select.innerHTML = '<option value="all">All Classes</option>';
        classes.forEach(function(cls) {
            var option = document.createElement('option');
            option.value = cls.id;
            option.textContent = cls.name;
            select.appendChild(option);
        });
        if (currentValue) select.value = currentValue;
    }

    function getStatusIndicator(status) {
        var statusLower = status.toLowerCase();
        if (statusLower === 'trainee' || statusLower === 'rookie') return '▸';
        if (statusLower === 'junior' || statusLower === 'senior') return '◆';
        if (statusLower === 'instructor') return '◇';
        if (statusLower === 'support') return '◈';
        if (statusLower === 'civilian') return '○';
        return '';
    }

    function getStatusColor(status) {
        var statusLower = status.toLowerCase();
        if (statusLower === 'trainee' || statusLower === 'rookie') return 'var(--accent)';
        if (statusLower === 'junior' || statusLower === 'senior') return 'var(--warning)';
        if (statusLower === 'instructor' || statusLower === 'support') return 'var(--info)';
        if (statusLower === 'civilian') return 'var(--text-dim)';
        return 'var(--text-dim)';
    }

    function getCharacterClassNames(char) {
        var names = [];
        if (char.classIds && char.classIds.length > 0) {
            var classes = window.getClasses();
            char.classIds.forEach(function(cid) {
                var cls = classes.find(function(c) { return String(c.id) === String(cid); });
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
