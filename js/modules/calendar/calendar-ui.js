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
 * 
 * IMPORTANT:
 *   - This module depends ONLY on CalendarModes registry
 *   - It does not know about students, instructors, or locations directly
 *   - All entity-specific logic is delegated to the registered modes
 */

(function() {
    'use strict';

    // ============================================================
    // DEPENDENCY CHECK
    // ============================================================

    if (!window.CalendarModes) {
        return;
    }

    // ============================================================
    // GUARD AGAINST DUPLICATE LOADING
    // ============================================================

    if (window.__calendarUILoaded) {
        return;
    }
    window.__calendarUILoaded = true;

    // ============================================================
    // CONSTANTS
    // ============================================================

    var CalendarModes = window.CalendarModes;

    // ============================================================
    // DEPENDENCY VALIDATION
    // ============================================================

    function checkDependencies() {
        var missing = [];

        if (!CalendarModes) {
            missing.push('CalendarModes');
        } else {
            if (typeof CalendarModes.getMode !== 'function') {
                missing.push('CalendarModes.getMode');
            }
            if (typeof CalendarModes.getModeOptions !== 'function') {
                missing.push('CalendarModes.getModeOptions');
            }
            if (typeof CalendarModes.hasMode !== 'function') {
                missing.push('CalendarModes.hasMode');
            }
        }

        if (missing.length > 0) {
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
        selectedId: null
    };

    var _container = null;
    var _initialized = false;
    var _onStateChange = null;

    // ============================================================
    // INIT
    // ============================================================

    function init(container, options, callbacks) {
        if (!checkDependencies()) {
            if (container) {
                container.innerHTML = '<p class="empty-state">Calendar dependencies not loaded.</p>';
            }
            return;
        }

        _container = container;

        if (options) {
            if (options.mode && CalendarModes.hasMode(options.mode)) {
                _state.mode = options.mode;
            }
            if (options.week) {
                var week = parseInt(options.week, 10);
                if (!isNaN(week) && week >= 1 && week <= 52) {
                    _state.week = week;
                }
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
            return;
        }

        if (!_initialized) {
            _container.innerHTML = '<p class="empty-state">Calendar not initialized.</p>';
            return;
        }

        // Ensure selection is valid before rendering
        ensureValidSelection();

        _container.innerHTML = getCalendarUIHTML();

        populateModeSelector();
        populateEntitySelector();
        renderCalendarGrid();
        bindEvents();
    }

    // ============================================================
    // STATE VALIDATION
    // ============================================================

    function ensureValidSelection() {
        var mode = CalendarModes.getMode(_state.mode);
        if (!mode || typeof mode.getEntities !== 'function') {
            _state.selectedId = null;
            return;
        }

        var entities = mode.getEntities() || [];
        var exists = false;

        for (var i = 0; i < entities.length; i++) {
            if (String(entities[i].id) === String(_state.selectedId)) {
                exists = true;
                break;
            }
        }

        if (!exists) {
            _state.selectedId = entities.length > 0 ? entities[0].id : null;
        }
    }

    // ============================================================
    // CALENDAR UI HTML
    // ============================================================

    function getCalendarUIHTML() {
        var options = CalendarModes.getModeOptions();
        var optionsHTML = '';
        for (var i = 0; i < options.length; i++) {
            var opt = options[i];
            optionsHTML += '<option value="' + opt.value + '">' + opt.label + '</option>';
        }

        return (
            '<div class="calendar-ui">' +
                '<div class="calendar-controls">' +
                    '<div class="mode-selector">' +
                        '<label for="calendar-mode-select">View:</label>' +
                        '<select id="calendar-mode-select">' +
                            optionsHTML +
                        '</select>' +
                    '</div>' +
                    '<div class="entity-selector">' +
                        '<label for="calendar-entity-select" id="calendar-entity-label">Entity:</label>' +
                        '<select id="calendar-entity-select">' +
                            '<option value="">Select...</option>' +
                        '</select>' +
                    '</div>' +
                    '<div class="week-nav">' +
                        '<button id="calendar-prev-week" class="small">[<]</button>' +
                        '<span id="calendar-week-display" style="font-weight:600;min-width:80px;text-align:center;">Week 1</span>' +
                        '<button id="calendar-next-week" class="small">[>]</button>' +
                    '</div>' +
                '</div>' +
                '<div class="schedule-grid-wrapper" id="calendar-grid-wrapper">' +
                    '<div class="schedule-grid" id="calendar-grid">' +
                        '<div class="day-column" data-day="1">' +
                            '<div class="day-header">Monday</div>' +
                            '<div class="day-slots"></div>' +
                        '</div>' +
                        '<div class="day-column" data-day="2">' +
                            '<div class="day-header">Tuesday</div>' +
                            '<div class="day-slots"></div>' +
                        '</div>' +
                        '<div class="day-column" data-day="3">' +
                            '<div class="day-header">Wednesday</div>' +
                            '<div class="day-slots"></div>' +
                        '</div>' +
                        '<div class="day-column" data-day="4">' +
                            '<div class="day-header">Thursday</div>' +
                            '<div class="day-slots"></div>' +
                        '</div>' +
                        '<div class="day-column" data-day="5">' +
                            '<div class="day-header">Friday</div>' +
                            '<div class="day-slots"></div>' +
                        '</div>' +
                        '<div class="day-column" data-day="6">' +
                            '<div class="day-header">Saturday</div>' +
                            '<div class="day-slots"></div>' +
                        '</div>' +
                        '<div class="day-column" data-day="7">' +
                            '<div class="day-header">Sunday</div>' +
                            '<div class="day-slots"></div>' +
                        '</div>' +
                    '</div>' +
                '</div>' +
                '<div style="margin-top:8px;font-size:0.7rem;color:var(--text-dim);text-align:center;">' +
                    getModeHint() +
                '</div>' +
            '</div>'
        );
    }

    // ============================================================
    // MODE HINT - Dynamic from registry
    // ============================================================

    function getModeHint() {
        var mode = CalendarModes.getMode(_state.mode);
        if (mode && mode.hint) {
            return mode.hint;
        }
        return 'Select a view to begin';
    }

    // ============================================================
    // POPULATE SELECTORS
    // ============================================================

    function populateModeSelector() {
        var select = document.getElementById('calendar-mode-select');
        if (!select) {
            return;
        }

        select.value = _state.mode;
    }

    function populateEntitySelector() {
        var select = document.getElementById('calendar-entity-select');
        var label = document.getElementById('calendar-entity-label');
        if (!select) {
            return;
        }

        var mode = CalendarModes.getMode(_state.mode);
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

        var selectionExists = false;

        for (var i = 0; i < entities.length; i++) {
            var entity = entities[i];
            var name = mode.getEntityDisplayName(entity);
            var option = document.createElement('option');
            option.value = entity.id;
            option.textContent = name;

            if (String(entity.id) === String(_state.selectedId)) {
                option.selected = true;
                selectionExists = true;
            }

            select.appendChild(option);
        }

        // Auto-heal: if selection doesn't exist, select first entity
        if (!selectionExists && entities.length > 0) {
            _state.selectedId = entities[0].id;
            select.value = String(_state.selectedId);
            // Notify state change after auto-heal
            if (_onStateChange) {
                _onStateChange(getState());
            }
        } else if (!selectionExists) {
            _state.selectedId = null;
        }
    }

    // ============================================================
    // RENDER CALENDAR GRID
    // ============================================================

    function renderCalendarGrid() {
        var mode = CalendarModes.getMode(_state.mode);
        if (!mode) {
            var grid = document.getElementById('calendar-grid');
            if (grid) {
                grid.innerHTML = '<p class="empty-state">Mode not available</p>';
            }
            return;
        }

        var container = document.getElementById('calendar-grid');
        if (container) {
            mode.render(container, _state);
        }

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
            if (!CalendarModes.hasMode(newState.mode)) {
                return;
            }
            _state.mode = newState.mode;
            changed = true;
            _state.selectedId = null;
        }

        if (newState.week !== undefined && newState.week !== _state.week) {
            var week = parseInt(newState.week, 10);
            if (!isNaN(week) && week >= 1 && week <= 52) {
                _state.week = week;
                changed = true;
            }
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
        var modeSelect = document.getElementById('calendar-mode-select');
        if (modeSelect) {
            modeSelect.addEventListener('change', function() {
                setState({ mode: this.value });
            });
        }

        var entitySelect = document.getElementById('calendar-entity-select');
        if (entitySelect) {
            entitySelect.addEventListener('change', function() {
                setState({ selectedId: this.value });
            });
        }

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
