/**
 * js/modules/calendar/calendar-ui.js - Calendar UI Controller
 * Main UI controller for the unified calendar
 * Path: js/modules/calendar/calendar-ui.js
 * 
 * This module is responsible for:
 *   - Managing calendar state
 *   - Rendering the calendar UI
 *   - Switching between modes (student/instructor/location)
 *   - Handling navigation
 *   - Coordinating with mode-specific renderers
 */

(function() {
    'use strict';

    // Prevent duplicate loading
    if (window.__calendarUILoaded) {
        return;
    }
    window.__calendarUILoaded = true;

    // ============================================================
    // DEPENDENCY CHECK
    // ============================================================

    function checkDependencies() {
        var required = [
            { name: 'CalendarModes', fn: window.CalendarModes },
            { name: 'getStudents', fn: window.getStudents },
            { name: 'getInstructors', fn: window.getInstructors },
            { name: 'getLocations', fn: window.getLocations },
            { name: 'getDisplayName', fn: window.getDisplayName }
        ];

        var missing = [];
        for (var i = 0; i < required.length; i++) {
            if (typeof required[i].fn !== 'function' && typeof required[i].fn !== 'object') {
                missing.push(required[i].name);
            }
        }

        if (missing.length > 0) {
            console.warn('[CalendarUI] Missing dependencies:', missing.join(', '));
            return false;
        }
        return true;
    }

    // ============================================================
    // STATE
    // ============================================================

    var _state = {
        mode: 'student',
        week: 1,
        selectedId: null,
        entityList: [],
        expandedGroups: {}
    };

    var _container = null;
    var _initialized = false;
    var _onStateChange = null;

    // ============================================================
    // INIT
    // ============================================================

    function init(container, options, callbacks) {
        if (!checkDependencies()) {
            return;
        }

        _container = container;

        if (options) {
            if (options.mode && window.CalendarModes.getMode(options.mode)) {
                _state.mode = options.mode;
            }
            if (options.week) {
                _state.week = options.week;
            }
            if (options.selectedId) {
                _state.selectedId = options.selectedId;
            }
        }

        if (callbacks && typeof callbacks.onStateChange === 'function') {
            _onStateChange = callbacks.onStateChange;
        }

        _initialized = true;

        render();
    }

    // ============================================================
    // RENDER
    // ============================================================

    function render() {
        if (!_container) {
            console.warn('[CalendarUI] No container set.');
            return;
        }

        if (!_initialized) {
            _container.innerHTML = '<p class="empty-state">Calendar not initialized.</p>';
            return;
        }

        // Build the UI
        _container.innerHTML = getCalendarUIHTML();

        // Populate mode selector
        populateModeSelector();

        // Populate entity selector
        populateEntitySelector();

        // Render the calendar grid
        renderCalendarGrid();

        // Bind events
        bindEvents();
    }

    // ============================================================
    // CALENDAR UI HTML
    // ============================================================

    function getCalendarUIHTML() {
        return `
            <div class="calendar-ui">
                <div class="calendar-controls">
                    <div class="mode-selector">
                        <label for="calendar-mode-select">View:</label>
                        <select id="calendar-mode-select">
                            ${window.CalendarModes.getModeOptions().map(function(opt) {
                                return '<option value="' + opt.value + '">' + opt.label + '</option>';
                            }).join('')}
                        </select>
                    </div>
                    <div class="entity-selector">
                        <label for="calendar-entity-select" id="calendar-entity-label">Student:</label>
                        <select id="calendar-entity-select">
                            <option value="">Select...</option>
                        </select>
                    </div>
                    <div class="week-nav">
                        <button id="calendar-prev-week" class="small">← Prev</button>
                        <span id="calendar-week-display" style="font-weight:600;min-width:80px;text-align:center;">Week 1</span>
                        <button id="calendar-next-week" class="small">Next →</button>
                    </div>
                </div>
                <div class="schedule-grid-wrapper" id="calendar-grid-wrapper">
                    <div class="schedule-grid" id="calendar-grid">
                        <div class="day-column" data-day="1">
                            <div class="day-header">Monday</div>
                            <div class="day-slots"></div>
                        </div>
                        <div class="day-column" data-day="2">
                            <div class="day-header">Tuesday</div>
                            <div class="day-slots"></div>
                        </div>
                        <div class="day-column" data-day="3">
                            <div class="day-header">Wednesday</div>
                            <div class="day-slots"></div>
                        </div>
                        <div class="day-column" data-day="4">
                            <div class="day-header">Thursday</div>
                            <div class="day-slots"></div>
                        </div>
                        <div class="day-column" data-day="5">
                            <div class="day-header">Friday</div>
                            <div class="day-slots"></div>
                        </div>
                        <div class="day-column" data-day="6">
                            <div class="day-header">Saturday</div>
                            <div class="day-slots"></div>
                        </div>
                        <div class="day-column" data-day="7">
                            <div class="day-header">Sunday</div>
                            <div class="day-slots"></div>
                        </div>
                    </div>
                </div>
                <div style="margin-top:8px;font-size:0.7rem;color:var(--text-dim);text-align:center;">
                    ${getModeHint()}
                </div>
            </div>
        `;
    }

    function getModeHint() {
        switch (_state.mode) {
            case 'student':
                return 'Click a slot to add class • Right-click to remove • Rest days are user-configurable';
            case 'instructor':
                return 'Click a slot to add class • Right-click to remove • Click class to manage students';
            case 'location':
                return 'Click a slot to assign a class • Right-click to remove';
            default:
                return 'Select a view to begin';
        }
    }

    // ============================================================
    // POPULATE SELECTORS
    // ============================================================

    function populateModeSelector() {
        var select = document.getElementById('calendar-mode-select');
        if (!select) return;

        select.value = _state.mode;
    }

    function populateEntitySelector() {
        var select = document.getElementById('calendar-entity-select');
        var label = document.getElementById('calendar-entity-label');
        if (!select) return;

        var mode = window.CalendarModes.getMode(_state.mode);
        if (!mode) {
            select.innerHTML = '<option value="">No mode available</option>';
            return;
        }

        var entities = mode.getEntities() || [];
        var modeLabel = mode.label || 'Entity';

        if (label) {
            label.textContent = modeLabel + ':';
        }

        select.innerHTML = '<option value="">Select ' + modeLabel.toLowerCase() + '...</option>';

        entities.forEach(function(entity) {
            var name = mode.getEntityDisplayName(entity);
            var option = document.createElement('option');
            option.value = entity.id;
            option.textContent = name;
            if (String(entity.id) === String(_state.selectedId)) {
                option.selected = true;
            }
            select.appendChild(option);
        });

        // If no selection and we have entities, select the first
        if (!_state.selectedId && entities.length > 0) {
            select.selectedIndex = 1;
            _state.selectedId = entities[0].id;
        }
    }

    // ============================================================
    // RENDER CALENDAR GRID
    // ============================================================

    function renderCalendarGrid() {
        var mode = window.CalendarModes.getMode(_state.mode);
        if (!mode) {
            var grid = document.getElementById('calendar-grid');
            if (grid) {
                grid.innerHTML = '<p class="empty-state">Mode not available</p>';
            }
            return;
        }

        // Delegate to mode-specific renderer
        var container = document.getElementById('calendar-grid');
        if (container) {
            mode.render(container, _state);
        }

        // Update week display
        var weekDisplay = document.getElementById('calendar-week-display');
        if (weekDisplay) {
            weekDisplay.textContent = 'Week ' + _state.week;
        }
    }

    // ============================================================
    // STATE MANAGEMENT
    // ============================================================

    function getState() {
        return {
            mode: _state.mode,
            week: _state.week,
            selectedId: _state.selectedId
        };
    }

    function setState(newState) {
        var changed = false;

        if (newState.mode !== undefined && newState.mode !== _state.mode) {
            _state.mode = newState.mode;
            changed = true;
            // Reset selection when mode changes
            _state.selectedId = null;
        }

        if (newState.week !== undefined && newState.week !== _state.week) {
            _state.week = newState.week;
            changed = true;
        }

        if (newState.selectedId !== undefined && newState.selectedId !== _state.selectedId) {
            _state.selectedId = newState.selectedId;
            changed = true;
        }

        if (changed) {
            render();
            if (_onStateChange) {
                _onStateChange(getState());
            }
        }
    }

    // ============================================================
    // EVENTS
    // ============================================================

    function bindEvents() {
        // Mode selector
        var modeSelect = document.getElementById('calendar-mode-select');
        if (modeSelect) {
            modeSelect.addEventListener('change', function() {
                setState({ mode: this.value });
            });
        }

        // Entity selector
        var entitySelect = document.getElementById('calendar-entity-select');
        if (entitySelect) {
            entitySelect.addEventListener('change', function() {
                setState({ selectedId: this.value });
            });
        }

        // Week navigation
        var prevBtn = document.getElementById('calendar-prev-week');
        if (prevBtn) {
            prevBtn.addEventListener('click', function() {
                if (_state.week > 1) {
                    setState({ week: _state.week - 1 });
                }
            });
        }

        var nextBtn = document.getElementById('calendar-next-week');
        if (nextBtn) {
            nextBtn.addEventListener('click', function() {
                if (_state.week < 52) {
                    setState({ week: _state.week + 1 });
                }
            });
        }
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.CalendarUI = {
        init: init,
        render: render,
        getState: getState,
        setState: setState
    };

})();
