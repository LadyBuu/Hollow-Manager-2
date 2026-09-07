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
 *   - This module depends on CalendarModes registry for mode behaviour
 *   - It does not know about students, instructors, or locations directly
 *   - All entity-specific logic is delegated to the registered modes
 *   - USES DomUtils.escapeHtml() - SINGLE SOURCE OF TRUTH
 *   - Uses CalendarConstants for bounds
 *   - Uses CalendarValidation for validation
 *   - No direct window.data access
 *   - State mutations are validated before being applied
 *   - Rendering does NOT mutate state (except through setState)
 * 
 * LIFECYCLE:
 *   - init(container, options, callbacks) - Initialize the calendar UI
 *   - render() - Re-render the current view
 *   - destroy() - Clean up event listeners
 *   - getState() / setState() - State management
 * 
 * DEPENDENCIES:
 *   - window.CalendarModes (from modes/index.js) - MANDATORY
 *   - window.CalendarUtils (from calendar-utils.js) - MANDATORY
 *   - window.DomUtils (from dom-utils.js) - MANDATORY
 *   - window.CalendarConstants (from shared/calendar-constants.js) - MANDATORY
 *   - window.CalendarValidation (from calendar-validation.js) - MANDATORY
 * 
 * USAGE:
 *   var ui = window.CalendarUI;
 *   ui.init(container, { mode: 'student', week: 1 }, {
 *       onStateChange: function(state) { console.log(state); }
 *   });
 */

(function() {
    'use strict';

    // ============================================================
    // GUARD AGAINST DUPLICATE LOADING
    // ============================================================

    if (window.__calendarUILoaded) {
        return;
    }

    // ============================================================
    // DEPENDENCY CHECK - MANDATORY (no fallbacks)
    // ============================================================

    var missing = [];

    if (!window.CalendarModes || typeof window.CalendarModes.getMode !== 'function') {
        missing.push('CalendarModes.getMode');
    }
    if (!window.CalendarModes || typeof window.CalendarModes.getModeOptions !== 'function') {
        missing.push('CalendarModes.getModeOptions');
    }
    if (!window.CalendarModes || typeof window.CalendarModes.hasMode !== 'function') {
        missing.push('CalendarModes.hasMode');
    }
    if (!window.CalendarModes || typeof window.CalendarModes.getModeNames !== 'function') {
        missing.push('CalendarModes.getModeNames');
    }

    if (!window.CalendarUtils || typeof window.CalendarUtils.formatHour !== 'function') {
        missing.push('CalendarUtils.formatHour');
    }

    if (!window.DomUtils || typeof window.DomUtils.escapeHtml !== 'function') {
        missing.push('DomUtils.escapeHtml');
    }

    if (!window.CalendarConstants) {
        missing.push('CalendarConstants');
    }

    if (!window.CalendarValidation || typeof window.CalendarValidation.parseWeek !== 'function') {
        missing.push('CalendarValidation.parseWeek');
    }

    if (missing.length > 0) {
        throw new Error('[CalendarUI] Missing dependencies: ' + missing.join(', '));
    }

    window.__calendarUILoaded = true;

    // ============================================================
    // DEPENDENCY IMPORTS
    // ============================================================

    var CalendarModes = window.CalendarModes;
    var CalendarUtils = window.CalendarUtils;
    var DomUtils = window.DomUtils;
    var CalendarConstants = window.CalendarConstants;
    var CalendarValidation = window.CalendarValidation;

    // ============================================================
    // CONSTANTS
    // ============================================================

    var MIN_WEEK = CalendarConstants.MIN_WEEK;
    var MAX_WEEK = CalendarConstants.MAX_WEEK;
    var MIN_DAY = CalendarConstants.MIN_DAY;
    var MAX_DAY = CalendarConstants.MAX_DAY;

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
    // EVENT LISTENER TRACKING
    // ============================================================

    var _eventListeners = [];

    function addEventListener(element, eventName, handler, options) {
        if (!element) {
            return;
        }
        element.addEventListener(eventName, handler, options || false);
        _eventListeners.push({
            element: element,
            eventName: eventName,
            handler: handler,
            options: options || false
        });
    }

    function removeAllEventListeners() {
        for (var i = 0; i < _eventListeners.length; i++) {
            var item = _eventListeners[i];
            try {
                item.element.removeEventListener(item.eventName, item.handler, item.options);
            } catch (e) {
                // Ignore errors during cleanup
            }
        }
        _eventListeners = [];
    }

    // ============================================================
    // HTML ESCAPING - Delegates to DomUtils (SINGLE SOURCE OF TRUTH)
    // ============================================================

    function escapeHtml(value) {
        return DomUtils.escapeHtml(value);
    }

    // ============================================================
    // INIT
    // ============================================================

    function init(container, options, callbacks) {
        // Remove existing listeners before initializing
        removeAllEventListeners();

        _container = container;

        // Apply options
        if (options) {
            if (options.mode && CalendarModes.hasMode(options.mode)) {
                _state.mode = options.mode;
            }
            if (options.week !== undefined) {
                var week = validateWeek(options.week);
                if (week !== null) {
                    _state.week = week;
                }
            }
            if (options.selectedId !== undefined) {
                _state.selectedId = options.selectedId;
            }
        }

        // Validate selection
        validateSelection();

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

        // Remove existing listeners before re-rendering
        removeAllEventListeners();

        // Ensure selection is valid before rendering
        validateSelection();

        _container.innerHTML = getCalendarUIHTML();

        populateModeSelector();
        populateEntitySelector();
        renderCalendarGrid();
        bindEvents();
    }

    // ============================================================
    // DESTROY
    // ============================================================

    function destroy() {
        removeAllEventListeners();
        _container = null;
        _initialized = false;
        _onStateChange = null;
    }

    // ============================================================
    // STATE VALIDATION
    // ============================================================

    function validateWeek(value) {
        return CalendarValidation.parseWeek(value);
    }

    function validateSelection() {
        var mode = CalendarModes.getMode(_state.mode);
        if (!mode || typeof mode.getEntities !== 'function') {
            _state.selectedId = null;
            return;
        }

        var entities = mode.getEntities();
        if (!Array.isArray(entities) || entities.length === 0) {
            _state.selectedId = null;
            return;
        }

        // Check if current selectedId exists
        var exists = false;
        for (var i = 0; i < entities.length; i++) {
            if (String(entities[i].id) === String(_state.selectedId)) {
                exists = true;
                break;
            }
        }

        if (!exists) {
            _state.selectedId = entities[0].id;
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
        if (!newState || typeof newState !== 'object') {
            return;
        }

        var changed = false;
        var previousState = {
            mode: _state.mode,
            week: _state.week,
            selectedId: _state.selectedId
        };

        // Handle mode change
        if (newState.mode !== undefined && newState.mode !== _state.mode) {
            if (!CalendarModes.hasMode(newState.mode)) {
                return;
            }
            _state.mode = newState.mode;
            _state.selectedId = null;
            changed = true;
        }

        // Handle week change
        if (newState.week !== undefined && newState.week !== _state.week) {
            var week = validateWeek(newState.week);
            if (week !== null) {
                _state.week = week;
                changed = true;
            }
        }

        // Handle selected ID change
        if (newState.selectedId !== undefined && newState.selectedId !== _state.selectedId) {
            _state.selectedId = newState.selectedId;
            changed = true;
        }

        if (changed) {
            // Validate selection after state change
            validateSelection();

            render();

            // Fire callback exactly once
            if (_onStateChange) {
                var currentState = getState();
                _onStateChange(currentState);
            }
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
            var selected = opt.value === _state.mode ? ' selected' : '';
            optionsHTML += '<option value="' + escapeHtml(opt.value) + '"' + selected + '>' + escapeHtml(opt.label) + '</option>';
        }

        var html = '';
        html += '<div class="calendar-ui">';
        html += '<div class="calendar-controls">';
        html += '<div class="mode-selector">';
        html += '<label for="calendar-mode-select">View:</label>';
        html += '<select id="calendar-mode-select">';
        html += optionsHTML;
        html += '</select>';
        html += '</div>';
        html += '<div class="entity-selector">';
        html += '<label for="calendar-entity-select" id="calendar-entity-label">Entity:</label>';
        html += '<select id="calendar-entity-select">';
        html += '<option value="">Select...</option>';
        html += '</select>';
        html += '</div>';
        html += '<div class="week-nav">';
        html += '<button id="calendar-prev-week" class="small" title="Previous Week">‹</button>';
        html += '<span id="calendar-week-display" class="week-display">Week ' + _state.week + '</span>';
        html += '<button id="calendar-next-week" class="small" title="Next Week">›</button>';
        html += '</div>';
        html += '</div>';
        html += '<div class="schedule-grid-wrapper" id="calendar-grid-wrapper">';
        html += '<div id="calendar-grid"></div>';
        html += '</div>';
        html += '<div class="calendar-hint">' + escapeHtml(getModeHint()) + '</div>';
        html += '</div>';

        return html;
    }

    // ============================================================
    // MODE HINT
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

        for (var i = 0; i < entities.length; i++) {
            var entity = entities[i];
            var name = mode.getEntityDisplayName(entity);
            var option = document.createElement('option');
            option.value = entity.id;
            option.textContent = name;

            if (String(entity.id) === String(_state.selectedId)) {
                option.selected = true;
            }

            select.appendChild(option);
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
    // EVENTS
    // ============================================================

    function bindEvents() {
        var modeSelect = document.getElementById('calendar-mode-select');
        if (modeSelect) {
            addEventListener(modeSelect, 'change', function() {
                setState({ mode: this.value });
            });
        }

        var entitySelect = document.getElementById('calendar-entity-select');
        if (entitySelect) {
            addEventListener(entitySelect, 'change', function() {
                setState({ selectedId: this.value });
            });
        }

        var prevBtn = document.getElementById('calendar-prev-week');
        if (prevBtn) {
            addEventListener(prevBtn, 'click', function() {
                if (_state.week > MIN_WEEK) {
                    setState({ week: _state.week - 1 });
                }
            });
        }

        var nextBtn = document.getElementById('calendar-next-week');
        if (nextBtn) {
            addEventListener(nextBtn, 'click', function() {
                if (_state.week < MAX_WEEK) {
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
        destroy: destroy,
        getState: getState,
        setState: setState
    };

})();