/**
 * js/modules/academia/academia-main.js - Academia Main Entry Point
 * Uses existing character list with class filter extension
 * Path: js/modules/academia/academia-main.js
 */

(function() {
    'use strict';

    if (window.__academiaMainLoaded) {
        return;
    }
    window.__academiaMainLoaded = true;

    // ============================================================
    // STATE
    // ============================================================

    var state = window.academiaState || {
        selectedCharacterId: null,
        filterClass: 'all',
        filterName: '',
        activeTab: 'schedule'
    };

    window.academiaState = state;

    // ============================================================
    // DEPENDENCIES
    // ============================================================

    function checkDependencies() {
        var missing = [];

        var required = [
            'getStudents',
            'getClasses',
            'getCharacterById',
            'getDisplayName',
            'getCurrentStatus',
            'getAvailableDisciplines',
            'getStudentSchedule',
            'getGrades',
            'saveGrades',
            'calculateGradeSummary',
            'CalendarUI',
            'CalendarModes'
        ];

        required.forEach(function(name) {
            if (typeof window[name] === 'undefined') {
                missing.push(name);
            }
        });

        if (missing.length > 0) {
            console.warn('[Academia] Missing dependencies:', missing.join(', '));
            return false;
        }

        return true;
    }

    // ============================================================
    // RENDER
    // ============================================================

    function renderAcademia(container) {
        if (!container) {
            container = document.getElementById('tab-academia');
        }
        if (!container) {
            return;
        }

        if (!window.data) {
            container.innerHTML = '<p class="empty-state">Loading academia data...</p>';
            return;
        }

        if (!checkDependencies()) {
            container.innerHTML = '<p class="empty-state">Academia dependencies not loaded. Check console.</p>';
            return;
        }

        try {
            if (typeof window.ensureCurriculum === 'function') {
                window.ensureCurriculum();
            }
        } catch (e) {
            console.warn('[Academia] ensureCurriculum() failed:', e);
        }

        container.innerHTML = getAcademiaHTML();

        // Render the character list using existing CharacterList with class filter
        renderCharacterList(container);

        // Render the detail panel
        renderDetail(container);

        // Bind events
        bindEvents(container);
    }

    // ============================================================
    // ACADEMIA HTML
    // ============================================================

    function getAcademiaHTML() {
        return `
            <div class="page-header">
                <h2>Academia</h2>
                <div style="display:flex;gap:8px;align-items:center;">
                    <button id="academia-refresh-btn" class="small secondary">↻ Refresh</button>
                </div>
            </div>
            <div class="academia-layout" style="display:grid;grid-template-columns:320px 1fr;gap:16px;">
                <div id="academia-character-list" style="background:var(--panel);border:1px solid var(--border);border-radius:var(--radius);padding:10px;max-height:600px;overflow-y:auto;">
                    <div id="academia-list-container"></div>
                </div>
                <div id="academia-detail-container" style="background:var(--panel);border:1px solid var(--border);border-radius:var(--radius);padding:12px;overflow-y:auto;max-height:600px;">
                    <p class="empty-state">Select a character to view academic details.</p>
                </div>
            </div>
        `;
    }

    // ============================================================
    // CHARACTER LIST - Using existing style
    // ============================================================

    function renderCharacterList(container) {
        var listContainer = container.querySelector('#academia-list-container');
        if (!listContainer) {
            return;
        }

        var students = window.getStudents();
        var classes = window.getClasses();

        // Build filter HTML
        var html = '';

        // Class filter
        html += '<div class="academia-filters" style="margin-bottom:8px;">';
        html += '<select id="academia-class-filter" style="width:100%;padding:4px 6px;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:6px;font-size:0.7rem;margin-bottom:4px;">';
        html += '<option value="all">All Classes</option>';

        classes.sort(function(a, b) {
            return (a.name || '').localeCompare(b.name || '');
        });

        for (var i = 0; i < classes.length; i++) {
            var cls = classes[i];
            var selected = String(state.filterClass) === String(cls.id) ? ' selected' : '';
            html += '<option value="' + escapeHtml(cls.id) + '"' + selected + '>' + escapeHtml(cls.name) + '</option>';
        }

        html += '</select>';

        // Name filter
        html += '<input type="text" id="academia-name-filter" value="' + escapeHtml(state.filterName || '') + '" placeholder="Search characters..." style="width:100%;padding:4px 6px;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:6px;font-size:0.7rem;">';
        html += '</div>';

        // Character list
        html += '<div id="academia-characters-list" style="display:flex;flex-direction:column;gap:2px;max-height:450px;overflow-y:auto;">';

        // Filter students
        var filteredStudents = students.filter(function(char) {
            // Name filter
            if (state.filterName) {
                var name = window.getDisplayName(char);
                if (!name.toLowerCase().includes(state.filterName.toLowerCase())) {
                    return false;
                }
            }

            // Class filter
            if (state.filterClass !== 'all') {
                var classIds = Array.isArray(char.classIds) ? char.classIds : [];
                if (!classIds.some(function(id) { return String(id) === String(state.filterClass); })) {
                    return false;
                }
            }

            return true;
        });

        filteredStudents.sort(function(a, b) {
            return window.getDisplayName(a).localeCompare(window.getDisplayName(b));
        });

        if (filteredStudents.length === 0) {
            html += '<p class="empty-state" style="padding:10px;font-size:0.75rem;">No students found.</p>';
        } else {
            var selectedId = state.selectedCharacterId;

            for (var i = 0; i < filteredStudents.length; i++) {
                var char = filteredStudents[i];
                var name = window.getDisplayName(char);
                var status = window.getCurrentStatus(char);
                var isSelected = String(char.id) === String(selectedId);
                var isDeceased = char.deceased || false;

                var classesDisplay = '';
                if (char.classIds && char.classIds.length > 0) {
                    var classNames = char.classIds.map(function(id) {
                        var cls = window.getClass(id);
                        return cls ? cls.name : null;
                    }).filter(Boolean);
                    if (classNames.length > 0) {
                        classesDisplay = ' <span style="font-size:0.5rem;color:var(--text-dim);">(' + classNames.join(', ') + ')</span>';
                    }
                }

                html += '<div class="academia-list-item" data-id="' + escapeHtml(char.id) + '" style="display:flex;justify-content:space-between;align-items:center;padding:4px 8px;border-radius:4px;cursor:pointer;transition:0.15s;border-bottom:1px solid var(--border-soft);' + (isSelected ? 'background:var(--accent-soft);border-left:3px solid var(--accent);' : '') + (isDeceased ? 'opacity:0.4;' : '') + '">';
                html += '<span class="char-name" style="font-size:0.75rem;font-weight:500;">' + escapeHtml(name) + classesDisplay + '</span>';
                html += '<span class="char-status" style="font-size:0.55rem;color:var(--text-dim);">' + escapeHtml(status) + '</span>';
                html += '</div>';
            }
        }

        html += '</div>';

        listContainer.innerHTML = html;

        // Bind list click events
        var items = listContainer.querySelectorAll('.academia-list-item');
        for (var i = 0; i < items.length; i++) {
            var el = items[i];
            el.addEventListener('click', function() {
                state.selectedCharacterId = this.dataset.id;
                renderAcademia(container);
            });
        }

        // Bind filter events
        var classFilter = listContainer.querySelector('#academia-class-filter');
        if (classFilter) {
            classFilter.addEventListener('change', function() {
                state.filterClass = this.value;
                renderAcademia(container);
            });
        }

        var nameFilter = listContainer.querySelector('#academia-name-filter');
        if (nameFilter) {
            nameFilter.addEventListener('input', function() {
                state.filterName = this.value;
                clearTimeout(this._timeout);
                this._timeout = setTimeout(function() {
                    renderAcademia(container);
                }, 300);
            });
        }
    }

    // ============================================================
    // DETAIL PANEL - Using CalendarUI
    // ============================================================

    function renderDetail(container) {
        var detailContainer = container.querySelector('#academia-detail-container');
        if (!detailContainer) {
            return;
        }

        if (!state.selectedCharacterId) {
            detailContainer.innerHTML = '<p class="empty-state">Select a character to view academic details.</p>';
            return;
        }

        var char = window.getCharacterById(state.selectedCharacterId);
        if (!char) {
            detailContainer.innerHTML = '<p class="empty-state">Character not found.</p>';
            return;
        }

        var characterName = window.getDisplayName(char);
        var activeTab = state.activeTab || 'schedule';

        var html = '';
        html += '<div class="academia-detail-header" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:12px;padding-bottom:8px;border-bottom:1px solid var(--border-soft);">';
        html += '<h3 style="color:var(--accent);margin:0;">' + escapeHtml(characterName) + '</h3>';
        html += '<div style="display:flex;gap:4px;">';
        html += '<button class="academia-tab-btn small ' + (activeTab === 'schedule' ? 'primary' : 'secondary') + '" data-tab="schedule">Schedule</button>';
        html += '<button class="academia-tab-btn small ' + (activeTab === 'grades' ? 'primary' : 'secondary') + '" data-tab="grades">Grades</button>';
        html += '</div>';
        html += '</div>';

        html += '<div id="academia-detail-content">';
        if (activeTab === 'schedule') {
            html += '<div id="academia-schedule-container" style="min-height:300px;"></div>';
        } else {
            html += '<div id="academia-grades-container"></div>';
        }
        html += '</div>';

        detailContainer.innerHTML = html;

        // Render schedule or grades
        if (activeTab === 'schedule') {
            renderScheduleTab(detailContainer, char);
        } else {
            renderGradesTab(detailContainer, char);
        }

        // Bind tab switching
        var tabBtns = detailContainer.querySelectorAll('.academia-tab-btn');
        tabBtns.forEach(function(btn) {
            btn.addEventListener('click', function() {
                state.activeTab = this.dataset.tab;
                renderDetail(container);
            });
        });
    }

    // ============================================================
    // SCHEDULE TAB - Using CalendarUI
    // ============================================================

    function renderScheduleTab(container, char) {
        var scheduleContainer = container.querySelector('#academia-schedule-container');
        if (!scheduleContainer) {
            return;
        }

        if (typeof window.CalendarUI === 'undefined') {
            scheduleContainer.innerHTML = '<p class="empty-state">Calendar module not loaded.</p>';
            return;
        }

        if (typeof window.CalendarModes === 'undefined') {
            scheduleContainer.innerHTML = '<p class="empty-state">Calendar modes not loaded.</p>';
            return;
        }

        // Check if student mode is registered
        if (!window.CalendarModes.hasMode('student')) {
            scheduleContainer.innerHTML = '<p class="empty-state">Student calendar mode not loaded.</p>';
            return;
        }

        // Initialize CalendarUI
        if (window.CalendarUI) {
            // Get current week from state
            var week = window.academiaScheduleState ? window.academiaScheduleState.currentWeek || 1 : 1;

            // If we already have a calendar instance, just update state
            window.CalendarUI.setState({
                mode: 'student',
                selectedId: char.id,
                week: week
            });

            // Render the calendar
            window.CalendarUI.render();
        } else {
            scheduleContainer.innerHTML = '<p class="empty-state">Calendar UI not available.</p>';
        }
    }

    // ============================================================
    // GRADES TAB - Using existing grades view
    // ============================================================

    function renderGradesTab(container, char) {
        var gradesContainer = container.querySelector('#academia-grades-container');
        if (!gradesContainer) {
            return;
        }

        if (typeof window.renderAcademiaGrades === 'function') {
            window.renderAcademiaGrades(gradesContainer, char.id);
        } else {
            gradesContainer.innerHTML = '<p class="empty-state">Grades module not loaded.</p>';
        }
    }

    // ============================================================
    // BIND EVENTS
    // ============================================================

    function bindEvents(container) {
        var refreshBtn = container.querySelector('#academia-refresh-btn');
        if (refreshBtn) {
            refreshBtn.addEventListener('click', function() {
                renderAcademia(container);
            });
        }
    }

    // ============================================================
    // HTML ESCAPING
    // ============================================================

    function escapeHtml(value) {
        if (value === undefined || value === null) {
            return '';
        }
        var str = String(value);
        return str
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    // ============================================================
    // REGISTER WITH TABMANAGER
    // ============================================================

    if (typeof window.TabManager !== 'undefined') {
        window.TabManager.register('academia', renderAcademia);
    }

    // ============================================================
    // LIFECYCLE
    // ============================================================

    document.addEventListener('dataReady', function() {
        setTimeout(function() {
            var container = document.getElementById('tab-academia');
            if (container && container.style.display !== 'none') {
                renderAcademia(container);
            }
        }, 100);
    });

    document.addEventListener('tabChanged', function(e) {
        if (e.detail && e.detail.tab === 'academia') {
            var container = document.getElementById('tab-academia');
            if (container) {
                renderAcademia(container);
            }
        }
    });

    if (window.data) {
        setTimeout(function() {
            var container = document.getElementById('tab-academia');
            if (container && container.style.display !== 'none') {
                renderAcademia(container);
            }
        }, 200);
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.renderAcademia = renderAcademia;
    window.academiaState = state;

})();
