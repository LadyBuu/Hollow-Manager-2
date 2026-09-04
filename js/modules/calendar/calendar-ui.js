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
 *   - USES DomUtils.escapeHtml() - SINGLE SOURCE OF TRUTH
 *   - USES DomUtils for DOM manipulation
 *   - USES NotificationSystem for notifications (via DomUtils)
 * 
 * LIFECYCLE:
 *   - init(container, options, callbacks) - Initialize the calendar UI
 *   - render() - Re-render the current view
 *   - destroy() - Clean up event listeners
 *   - getState() / setState() - State management
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
    // DEPENDENCY CHECK - NO FALLBACKS
    // ============================================================

    if (!window.CalendarModes) {
        return;
    }

    if (!window.CalendarRenderer) {
        return;
    }

    if (!window.CalendarUtils) {
        return;
    }

    if (!window.DomUtils || typeof window.DomUtils.escapeHtml !== 'function') {
        return;
    }

    if (!window.NotificationSystem || typeof window.NotificationSystem.notify !== 'function') {
        return;
    }

    window.__calendarUILoaded = true;

    // ============================================================
    // CONSTANTS
    // ============================================================

    var CalendarModes = window.CalendarModes;
    var CalendarRenderer = window.CalendarRenderer;
    var CalendarUtils = window.CalendarUtils;
    var DomUtils = window.DomUtils;
    var NotificationSystem = window.NotificationSystem;

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

    function addSafeEventListener(element, eventName, handler, options) {
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
    // NOTIFICATION - Uses NotificationSystem (SINGLE SOURCE OF TRUTH)
    // ============================================================

    function showNotification(message, type) {
        type = type || 'info';
        NotificationSystem.notify(message, type);
    }

    // ============================================================
    // HTML ESCAPING - Delegates to DomUtils (SINGLE SOURCE OF TRUTH)
    // ============================================================

    function escapeHtml(value) {
        return DomUtils.escapeHtml(value);
    }

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

        if (!CalendarRenderer || typeof CalendarRenderer.renderGrid !== 'function') {
            missing.push('CalendarRenderer.renderGrid');
        }

        if (!CalendarUtils || typeof CalendarUtils.formatHour !== 'function') {
            missing.push('CalendarUtils.formatHour');
        }

        if (missing.length > 0) {
            return false;
        }

        return true;
    }

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

        // Remove existing listeners before initializing
        removeAllEventListeners();

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

        // Remove existing listeners before re-rendering
        removeAllEventListeners();

        // Ensure selection is valid before rendering
        ensureValidSelection();

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
            if (_onStateChange) {
                _onStateChange(getState());
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

        if (!selectionExists && entities.length > 0) {
            if (String(_state.selectedId) !== String(entities[0].id)) {
                _state.selectedId = entities[0].id;
                select.value = String(_state.selectedId);
                if (_onStateChange) {
                    _onStateChange(getState());
                }
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
        if (!newState || typeof newState !== 'object') {
            return;
        }

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
            addSafeEventListener(modeSelect, 'change', function() {
                setState({ mode: this.value });
            });
        }

        var entitySelect = document.getElementById('calendar-entity-select');
        if (entitySelect) {
            addSafeEventListener(entitySelect, 'change', function() {
                setState({ selectedId: this.value });
            });
        }

        var prevBtn = document.getElementById('calendar-prev-week');
        if (prevBtn) {
            addSafeEventListener(prevBtn, 'click', function() {
                if (_state.week > 1) {
                    setState({ week: _state.week - 1 });
                }
            });
        }

        var nextBtn = document.getElementById('calendar-next-week');
        if (nextBtn) {
            addSafeEventListener(nextBtn, 'click', function() {
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
        destroy: destroy,
        getState: getState,
        setState: setState
    };

})();
