/**
 * js/modules/calendar/index.js - Unified Calendar Entry Point
 * Single entry point for all calendar functionality
 * Path: js/modules/calendar/index.js
 * 
 * This module is responsible for:
 *   - Registering with TabManager
 *   - Rendering the calendar container
 *   - Switching between student/instructor/location views
 *   - Managing calendar lifecycle
 *   - Restoring state from sessionStorage and URL hash
 * 
 * LIFECYCLE:
 *   TabManager registers 'calendar' -> renderCalendar() ->
 *   renderModeSelector() -> renderActiveMode() -> bindEvents()
 * 
 * IMPORTANT:
 *   - This module is the only external entry point for calendar
 *   - All calendar logic lives in sub-modules
 *   - This module does NOT implement calendar logic directly
 *   - It uses StudentCalendarUI, InstructorCalendarUI, LocationCalendarUI
 *   - TabManager is the single source of truth for lifecycle
 *   - No direct window.data access
 *   - Uses CalendarConstants for bounds
 *   - Uses CalendarValidation for validation
 * 
 * DEPENDENCIES:
 *   - window.StudentCalendarUI (from student-calendar-ui.js)
 *   - window.InstructorCalendarUI (from instructor-calendar-ui.js)
 *   - window.LocationCalendarUI (from location-calendar-ui.js)
 *   - window.TabManager (from tab-manager.js)
 *   - window.CalendarConstants (from shared/calendar-constants.js)
 *   - window.CalendarValidation (from calendar-validation.js)
 *   - window.CharacterQueries (from character-queries.js)
 *   - window.LocationQueries (from location-queries.js)
 * 
 * USAGE:
 *   var calendar = window.CalendarModule;
 *   calendar.render(container);
 *   calendar.switchMode('student');
 *   calendar.destroy();
 */

(function() {
    'use strict';

    if (window.__calendarModuleLoaded) {
        return;
    }

    var StudentCalendarUI = window.StudentCalendarUI;
    var InstructorCalendarUI = window.InstructorCalendarUI;
    var LocationCalendarUI = window.LocationCalendarUI;
    var TabManager = window.TabManager;
    var CalendarConstants = window.CalendarConstants;
    var CalendarValidation = window.CalendarValidation;
    var CharacterQueries = window.CharacterQueries;
    var LocationQueries = window.LocationQueries;

    function checkDependencies() {
        var missing = [];

        if (!StudentCalendarUI || typeof StudentCalendarUI.render !== 'function') {
            missing.push('StudentCalendarUI.render');
        }
        if (!StudentCalendarUI || typeof StudentCalendarUI.getState !== 'function') {
            missing.push('StudentCalendarUI.getState');
        }
        if (!StudentCalendarUI || typeof StudentCalendarUI.setState !== 'function') {
            missing.push('StudentCalendarUI.setState');
        }

        if (!InstructorCalendarUI || typeof InstructorCalendarUI.render !== 'function') {
            missing.push('InstructorCalendarUI.render');
        }
        if (!InstructorCalendarUI || typeof InstructorCalendarUI.getState !== 'function') {
            missing.push('InstructorCalendarUI.getState');
        }
        if (!InstructorCalendarUI || typeof InstructorCalendarUI.setState !== 'function') {
            missing.push('InstructorCalendarUI.setState');
        }

        if (!LocationCalendarUI || typeof LocationCalendarUI.render !== 'function') {
            missing.push('LocationCalendarUI.render');
        }
        if (!LocationCalendarUI || typeof LocationCalendarUI.getState !== 'function') {
            missing.push('LocationCalendarUI.getState');
        }
        if (!LocationCalendarUI || typeof LocationCalendarUI.setState !== 'function') {
            missing.push('LocationCalendarUI.setState');
        }

        if (!TabManager || typeof TabManager.register !== 'function') {
            missing.push('TabManager.register');
        }

        if (!CalendarConstants) {
            missing.push('CalendarConstants');
        }

        if (!CalendarValidation || typeof CalendarValidation.parseWeek !== 'function') {
            missing.push('CalendarValidation.parseWeek');
        }

        if (!CharacterQueries || typeof CharacterQueries.getStudents !== 'function') {
            missing.push('CharacterQueries.getStudents');
        }
        if (!CharacterQueries || typeof CharacterQueries.getInstructors !== 'function') {
            missing.push('CharacterQueries.getInstructors');
        }

        if (!LocationQueries || typeof LocationQueries.getLocations !== 'function') {
            missing.push('LocationQueries.getLocations');
        }

        if (missing.length > 0) {
            throw new Error('CalendarModule: Missing dependencies: ' + missing.join(', '));
        }

        return true;
    }

    checkDependencies();

    var MIN_WEEK = CalendarConstants.MIN_WEEK;
    var MAX_WEEK = CalendarConstants.MAX_WEEK;

    var MODES = [
        { id: 'student', label: 'Student', icon: '\uD83D\uDC64' },
        { id: 'instructor', label: 'Instructor', icon: '\uD83D\uDC68\u200D\uD83C\uDFEB' },
        { id: 'location', label: 'Location', icon: '\uD83D\uDCCD' }
    ];

    var _state = {
        mode: 'student',
        week: 1,
        selectedId: null
    };

    var _container = null;
    var _initialized = false;
    var _eventListeners = [];
    var _activeUI = null;

    function escapeHtml(value) {
        if (value === undefined || value === null) {
            return '';
        }
        return String(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function escapeAttribute(value) {
        if (value === undefined || value === null) {
            return '';
        }
        return String(value)
            .replace(/&/g, '&amp;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function render(container) {
        if (!container) {
            container = document.getElementById('tab-calendar');
        }

        if (!container) {
            throw new Error('CalendarModule: Container not found.');
        }

        if (!window.data) {
            container.innerHTML = '<p class="empty-state">Loading calendar data...</p>';
            return;
        }

        _container = container;

        destroy();

        initializeState();

        container.innerHTML = getContainerHTML();

        renderActiveMode();

        bindEvents();

        _initialized = true;
    }

    function destroy() {
        if (_activeUI) {
            if (_activeUI.destroy && typeof _activeUI.destroy === 'function') {
                _activeUI.destroy();
            }
            _activeUI = null;
        }

        removeAllEventListeners();

        _initialized = false;
    }

    function getContainerHTML() {
        var currentMode = _state.mode;
        var modeOptions = MODES.map(function(mode) {
            var active = mode.id === currentMode ? ' active' : '';
            return '<button class="mode-btn' + active + '" data-mode="' + escapeAttribute(mode.id) + '">' +
                escapeHtml(mode.icon) + ' ' + escapeHtml(mode.label) +
                '</button>';
        }).join('');

        var weekDisplay = 'Week ' + _state.week;

        var html = '';
        html += '<div class="calendar-module">';

        html += '<div class="calendar-controls">';
        html += '<div class="mode-selector">';
        html += modeOptions;
        html += '</div>';
        html += '<div class="week-nav">';
        html += '<button id="calendar-prev-week" class="small" title="Previous Week">‹</button>';
        html += '<span id="calendar-week-display" class="week-display">' + escapeHtml(weekDisplay) + '</span>';
        html += '<button id="calendar-next-week" class="small" title="Next Week">›</button>';
        html += '</div>';
        html += '<div class="entity-selector">';
        html += '<select id="calendar-entity-select">';
        html += '<option value="">Select...</option>';
        html += '</select>';
        html += '</div>';
        html += '</div>';

        html += '<div id="calendar-content" class="calendar-content">';
        html += '<div class="loading-state">Loading...</div>';
        html += '</div>';

        html += '</div>';

        return html;
    }

    function renderActiveMode() {
        var content = document.getElementById('calendar-content');
        if (!content) {
            return;
        }

        var ui = getModeUI(_state.mode);
        if (!ui) {
            content.innerHTML = '<div class="empty-state">Unknown mode: ' + escapeHtml(_state.mode) + '</div>';
            return;
        }

        _activeUI = ui;

        ui.render(content, {
            selectedId: _state.selectedId,
            week: _state.week
        });

        populateEntitySelector();

        updateWeekDisplay();
    }

    function getModeUI(mode) {
        switch (mode) {
            case 'student':
                return StudentCalendarUI;
            case 'instructor':
                return InstructorCalendarUI;
            case 'location':
                return LocationCalendarUI;
            default:
                return null;
        }
    }

    function populateEntitySelector() {
        var select = document.getElementById('calendar-entity-select');
        if (!select) {
            return;
        }

        var entities = getEntitiesForMode(_state.mode);
        var currentId = _state.selectedId;

        select.innerHTML = '<option value="">Select...</option>';

        for (var i = 0; i < entities.length; i++) {
            var entity = entities[i];
            var name = getEntityName(_state.mode, entity);
            var option = document.createElement('option');
            option.value = entity.id;
            option.textContent = name;
            if (String(entity.id) === String(currentId)) {
                option.selected = true;
            }
            select.appendChild(option);
        }
    }

    function getEntitiesForMode(mode) {
        switch (mode) {
            case 'student':
                return CharacterQueries.getStudents() || [];
            case 'instructor':
                return CharacterQueries.getInstructors() || [];
            case 'location':
                return LocationQueries.getLocations() || [];
            default:
                return [];
        }
    }

    function getEntityName(mode, entity) {
        switch (mode) {
            case 'student':
            case 'instructor':
                return CharacterQueries.getDisplayName(entity);
            case 'location':
                return entity.name || entity.id || 'Unknown';
            default:
                return entity.id || 'Unknown';
        }
    }

    function updateWeekDisplay() {
        var display = document.getElementById('calendar-week-display');
        if (display) {
            display.textContent = 'Week ' + _state.week;
        }
    }

    function initializeState() {
        var options = getInitialOptions();

        _state.mode = options.mode || 'student';
        _state.week = options.week || 1;
        _state.selectedId = options.selectedId || null;

        validateSelectedId();
    }

    function getInitialOptions() {
        var options = {
            mode: 'student',
            week: 1,
            selectedId: null
        };

        try {
            var saved = sessionStorage.getItem('calendar_state');
            if (saved) {
                var parsed = JSON.parse(saved);
                if (parsed.mode) {
                    options.mode = parsed.mode;
                }
                if (parsed.week !== undefined && parsed.week !== null) {
                    var week = CalendarValidation.parseWeek(parsed.week);
                    if (week !== null) {
                        options.week = week;
                    }
                }
                if (parsed.selectedId !== undefined && parsed.selectedId !== null) {
                    options.selectedId = parsed.selectedId;
                }
            }
        } catch (_) {
        }

        try {
            var hash = window.location.hash;
            if (hash) {
                var queryIndex = hash.indexOf('?');
                if (queryIndex !== -1) {
                    var params = new URLSearchParams(hash.substring(queryIndex + 1));
                    var modeParam = params.get('mode');
                    if (modeParam) {
                        options.mode = modeParam;
                    }
                    var weekParam = params.get('week');
                    if (weekParam !== null) {
                        var week = CalendarValidation.parseWeek(weekParam);
                        if (week !== null) {
                            options.week = week;
                        }
                    }
                    var idParam = params.get('id');
                    if (idParam !== null) {
                        options.selectedId = idParam;
                    }
                }
            }
        } catch (_) {
        }

        if (!options.selectedId) {
            var entities = getEntitiesForMode(options.mode);
            if (entities.length > 0) {
                options.selectedId = entities[0].id;
            }
        }

        return options;
    }

    function validateSelectedId() {
        var entities = getEntitiesForMode(_state.mode);
        var exists = false;

        for (var i = 0; i < entities.length; i++) {
            if (String(entities[i].id) === String(_state.selectedId)) {
                exists = true;
                break;
            }
        }

        if (!exists && entities.length > 0) {
            _state.selectedId = entities[0].id;
        }
    }

    function saveState() {
        try {
            sessionStorage.setItem('calendar_state', JSON.stringify({
                mode: _state.mode,
                week: _state.week,
                selectedId: _state.selectedId
            }));
        } catch (_) {
        }

        try {
            var hash = window.location.hash || '';
            var base = hash.split('?')[0];
            if (base.charAt(0) === '#') {
                base = base.substring(1);
            }

            var query = 'mode=' + encodeURIComponent(_state.mode) +
                        '&week=' + encodeURIComponent(_state.week);

            if (_state.selectedId) {
                query += '&id=' + encodeURIComponent(_state.selectedId);
            }

            var newHash = '#' + base + '?' + query;

            if (window.location.hash !== newHash) {
                window.history.replaceState(null, '', newHash);
            }
        } catch (_) {
        }
    }

    function switchMode(mode) {
        var valid = false;
        for (var i = 0; i < MODES.length; i++) {
            if (MODES[i].id === mode) {
                valid = true;
                break;
            }
        }

        if (!valid) {
            return;
        }

        if (mode === _state.mode) {
            refresh();
            return;
        }

        _state.mode = mode;

        var entities = getEntitiesForMode(mode);
        if (entities.length > 0) {
            _state.selectedId = entities[0].id;
        } else {
            _state.selectedId = null;
        }

        var buttons = _container.querySelectorAll('.mode-btn');
        for (var i = 0; i < buttons.length; i++) {
            var btn = buttons[i];
            var btnMode = btn.dataset.mode;
            if (btnMode === mode) {
                btn.classList.add('active');
            } else {
                btn.classList.remove('active');
            }
        }

        renderActiveMode();

        populateEntitySelector();

        updateWeekDisplay();

        saveState();
    }

    function switchWeek(delta) {
        var newWeek = _state.week + delta;

        if (newWeek < MIN_WEEK) {
            newWeek = MIN_WEEK;
        }
        if (newWeek > MAX_WEEK) {
            newWeek = MAX_WEEK;
        }

        if (newWeek === _state.week) {
            return;
        }

        _state.week = newWeek;

        if (_activeUI && _activeUI.setState) {
            _activeUI.setState({ week: newWeek });
        }

        updateWeekDisplay();

        saveState();
    }

    function selectEntity(entityId) {
        if (entityId === _state.selectedId) {
            return;
        }

        _state.selectedId = entityId;

        if (_activeUI && _activeUI.setState) {
            _activeUI.setState({ selectedId: entityId });
        }

        populateEntitySelector();

        saveState();
    }

    function refresh() {
        if (_container) {
            renderActiveMode();
            populateEntitySelector();
            updateWeekDisplay();
        }
    }

    function bindEvents() {
        var modeButtons = _container.querySelectorAll('.mode-btn');
        for (var i = 0; i < modeButtons.length; i++) {
            var btn = modeButtons[i];
            addEventListener(btn, 'click', function() {
                var mode = this.dataset.mode;
                if (mode) {
                    switchMode(mode);
                }
            });
        }

        var prevBtn = document.getElementById('calendar-prev-week');
        if (prevBtn) {
            addEventListener(prevBtn, 'click', function() {
                switchWeek(-1);
            });
        }

        var nextBtn = document.getElementById('calendar-next-week');
        if (nextBtn) {
            addEventListener(nextBtn, 'click', function() {
                switchWeek(1);
            });
        }

        var entitySelect = document.getElementById('calendar-entity-select');
        if (entitySelect) {
            addEventListener(entitySelect, 'change', function() {
                var id = this.value;
                if (id) {
                    selectEntity(id);
                }
            });
        }
    }

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
            }
        }
        _eventListeners = [];
    }

    TabManager.register('calendar', render);

    window.__calendarModuleLoaded = true;

    window.CalendarModule = {
        render: render,
        destroy: destroy,
        refresh: refresh,

        switchMode: switchMode,
        switchWeek: switchWeek,
        selectEntity: selectEntity,

        getState: function() {
            return {
                mode: _state.mode,
                week: _state.week,
                selectedId: _state.selectedId
            };
        },

        setState: function(newState) {
            var changed = false;

            if (newState.mode !== undefined && newState.mode !== _state.mode) {
                switchMode(newState.mode);
                changed = true;
            }

            if (newState.week !== undefined && newState.week !== _state.week) {
                var week = CalendarValidation.parseWeek(newState.week);
                if (week !== null) {
                    _state.week = week;
                    if (_activeUI && _activeUI.setState) {
                        _activeUI.setState({ week: week });
                    }
                    updateWeekDisplay();
                    saveState();
                    changed = true;
                }
            }

            if (newState.selectedId !== undefined && newState.selectedId !== _state.selectedId) {
                selectEntity(newState.selectedId);
                changed = true;
            }

            return changed;
        }
    };

    window.renderCalendar = render;
    window.destroyCalendar = destroy;

})();