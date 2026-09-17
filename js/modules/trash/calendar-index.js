/**
 * modules/calendar/index.js - Calendar Module Entry Point
 * Unified entry point for all calendar functionality
 *
 * IMPORTANT:
 *   - Registers with TabManager
 *   - Assembles providers for Aggregator
 *   - Manages module lifecycle
 *   - Singleton pattern
 *   - No domain logic
 *   - No render logic (delegates to UI modules)
 *
 * LIFECYCLE:
 *   TabManager.register('calendar', render)
 *     → render(container)
 *       → destroyUI()             // tear down previous active UI
 *       → initializeState()       // sessionStorage + hash
 *       → container.innerHTML     // shell
 *       → renderActiveMode()      // delegate to active UI
 *       → bindEvents()            // shell-level events
 *
 *   destroy() (from TabManager on unmount):
 *     → destroyUI()
 *     → _container = null
 *
 * EVENT LISTENER TRACKING:
 *   - Every listener added by this module goes through `addTrackedListener`
 *     OR is stored with a full descriptor { element, eventName, handler, options }.
 *   - destroyUI() removes all tracked listeners by passing all three args
 *     to removeEventListener. Calling removeEventListener with only the
 *     event name is a no-op and was the original bug.
 *
 * DEPENDENCIES:
 *   - TabManager
 *   - StudentCalendarUI
 *   - InstructorCalendarUI
 *   - LocationCalendarUI
 *   - CalendarAggregator (for initialization)
 *   - Shared Queries (for provider assembly)
 */

(function() {
    'use strict';

    if (window.__calendarModuleLoaded) { return; }
    window.__calendarModuleLoaded = true;

    var TabManager = window.TabManager;
    var StudentUI = window.StudentCalendarUI;
    var InstructorUI = window.InstructorCalendarUI;
    var LocationUI = window.LocationCalendarUI;

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
    var _eventListeners = [];
    var _activeUI = null;

    var MIN_WEEK = window.CalendarConstants ? window.CalendarConstants.MIN_WEEK : 1;
    var MAX_WEEK = window.CalendarConstants ? window.CalendarConstants.MAX_WEEK : 52;

    var MODES = [
        { id: 'student', label: 'Student', icon: '\uD83D\uDC64' },
        { id: 'instructor', label: 'Instructor', icon: '\uD83D\uDC68\u200D\uD83C\uDFEB' },
        { id: 'location', label: 'Location', icon: '\uD83D\uDCCD' }
    ];

    // ============================================================
    // HELPERS
    // ============================================================

    function escapeHtml(value) {
        if (value === undefined || value === null) { return ''; }
        return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
    }

    function escapeAttribute(value) {
        if (value === undefined || value === null) { return ''; }
        return String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
    }

    function getModeUI(mode) {
        switch (mode) {
            case 'student': return StudentUI;
            case 'instructor': return InstructorUI;
            case 'location': return LocationUI;
            default: return null;
        }
    }

    function getEntitySelectorClass(mode) {
        switch (mode) {
            case 'student': return 'student-select';
            case 'instructor': return 'instructor-select';
            case 'location': return 'location-select';
            default: return '';
        }
    }

    // ============================================================
    // TRACKED EVENT LISTENERS - FIX
    // ============================================================
    //
    // Every listener this module adds on the shell goes through
    // addTrackedListener, which stores the full descriptor. destroyUI
    // then removes each one with all three arguments. The previous
    // code stored only { element, eventName } and never stored the
    // handler, which made removeEventListener a silent no-op.

    function addTrackedListener(element, eventName, handler, options) {
        if (!element) {
            return;
        }
        var opts = options || false;
        element.addEventListener(eventName, handler, opts);
        _eventListeners.push({
            element: element,
            eventName: eventName,
            handler: handler,
            options: opts
        });
    }

    function removeAllTrackedListeners() {
        for (var i = 0; i < _eventListeners.length; i++) {
            var item = _eventListeners[i];
            try {
                item.element.removeEventListener(item.eventName, item.handler, item.options);
            } catch (e) {
                // Ignore cleanup errors
            }
        }
        _eventListeners = [];
    }

    // ============================================================
    // RENDER
    // ============================================================

    function render(container) {
        if (!container) {
            container = document.getElementById('tab-calendar');
        }

        if (!container) {
            console.warn('CalendarModule: Container not found.');
            return;
        }

        if (!window.data) {
            container.innerHTML = '<p class="empty-state">Loading calendar data...</p>';
            return;
        }

        _container = container;

        destroyUI();

        initializeState();

        container.innerHTML = getContainerHTML();

        renderActiveMode();

        bindEvents();

        _initialized = true;
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
        var selectClass = getEntitySelectorClass(currentMode);

        return (
            '<div class="calendar-module">' +
                '<div class="calendar-controls">' +
                    '<div class="mode-selector">' + modeOptions + '</div>' +
                    '<div class="week-nav">' +
                        '<button id="calendar-prev-week" class="small" title="Previous Week">‹</button>' +
                        '<span id="calendar-week-display" class="week-display">' + escapeHtml(weekDisplay) + '</span>' +
                        '<button id="calendar-next-week" class="small" title="Next Week">›</button>' +
                    '</div>' +
                    '<div class="entity-selector">' +
                        '<select id="calendar-entity-select" class="' + escapeAttribute(selectClass) + '">' +
                            '<option value="">Select...</option>' +
                        '</select>' +
                    '</div>' +
                '</div>' +
                '<div id="calendar-content" class="calendar-content">' +
                    '<div class="loading-state">Loading...</div>' +
                '</div>' +
            '</div>'
        );
    }

    function renderActiveMode() {
        var content = document.getElementById('calendar-content');
        if (!content) { return; }

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

    function populateEntitySelector() {
        var select = document.getElementById('calendar-entity-select');
        if (!select) { return; }

        // Get entities from the active UI
        var entities = [];
        var currentId = _state.selectedId;

        switch (_state.mode) {
            case 'student':
                entities = StudentUI.getStudents ? StudentUI.getStudents() : [];
                break;
            case 'instructor':
                entities = InstructorUI.getInstructors ? InstructorUI.getInstructors() : [];
                break;
            case 'location':
                entities = LocationUI.getLocations ? LocationUI.getLocations() : [];
                break;
        }

        select.innerHTML = '<option value="">Select...</option>';

        for (var i = 0; i < entities.length; i++) {
            var entity = entities[i];
            var name = entity.name || entity.id || 'Unknown';
            var option = document.createElement('option');
            option.value = entity.id;
            option.textContent = name;
            if (String(entity.id) === String(currentId)) {
                option.selected = true;
            }
            select.appendChild(option);
        }
    }

    function updateWeekDisplay() {
        var display = document.getElementById('calendar-week-display');
        if (display) {
            display.textContent = 'Week ' + _state.week;
        }
    }

    // ============================================================
    // STATE MANAGEMENT
    // ============================================================

    function initializeState() {
        var options = getInitialOptions();
        _state.mode = options.mode || 'student';
        _state.week = options.week || 1;
        _state.selectedId = options.selectedId || null;

        // Ensure selectedId is valid for the current mode
        validateSelectedId();
    }

    function getInitialOptions() {
        var options = { mode: 'student', week: 1, selectedId: null };

        // Try sessionStorage
        try {
            var saved = sessionStorage.getItem('calendar_state');
            if (saved) {
                var parsed = JSON.parse(saved);
                if (parsed.mode) { options.mode = parsed.mode; }
                if (parsed.week !== undefined && parsed.week !== null) {
                    var week = parseInt(parsed.week, 10);
                    if (!isNaN(week) && week >= MIN_WEEK && week <= MAX_WEEK) {
                        options.week = week;
                    }
                }
                if (parsed.selectedId !== undefined && parsed.selectedId !== null) {
                    options.selectedId = parsed.selectedId;
                }
            }
        } catch (_) {}

        // Try URL hash
        // FIX: guard URLSearchParams — not available in all environments.
        try {
            var hash = window.location.hash;
            if (hash && typeof window.URLSearchParams === 'function') {
                var queryIndex = hash.indexOf('?');
                if (queryIndex !== -1) {
                    var params = new URLSearchParams(hash.substring(queryIndex + 1));
                    var modeParam = params.get('mode');
                    if (modeParam) { options.mode = modeParam; }
                    var weekParam = params.get('week');
                    if (weekParam !== null) {
                        var week = parseInt(weekParam, 10);
                        if (!isNaN(week) && week >= MIN_WEEK && week <= MAX_WEEK) {
                            options.week = week;
                        }
                    }
                    var idParam = params.get('id');
                    if (idParam !== null) {
                        options.selectedId = idParam;
                    }
                }
            }
        } catch (_) {}

        // Set default selectedId if needed
        if (!options.selectedId) {
            var entities = getEntitiesForMode(options.mode);
            if (entities.length > 0) {
                options.selectedId = entities[0].id;
            }
        }

        return options;
    }

    function getEntitiesForMode(mode) {
        switch (mode) {
            case 'student':
                return StudentUI.getStudents ? StudentUI.getStudents() : [];
            case 'instructor':
                return InstructorUI.getInstructors ? InstructorUI.getInstructors() : [];
            case 'location':
                return LocationUI.getLocations ? LocationUI.getLocations() : [];
            default:
                return [];
        }
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
        } catch (_) {}

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
        } catch (_) {}
    }

    // ============================================================
    // ACTIONS
    // ============================================================

    function switchMode(mode) {
        var valid = false;
        for (var i = 0; i < MODES.length; i++) {
            if (MODES[i].id === mode) { valid = true; break; }
        }
        if (!valid) { return; }

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

        // FIX: renamed loop variable to avoid shadowing the outer `i`.
        var buttons = _container.querySelectorAll('.mode-btn');
        for (var b = 0; b < buttons.length; b++) {
            var btn = buttons[b];
            var btnMode = btn.dataset.mode;
            if (btnMode === mode) {
                btn.classList.add('active');
            } else {
                btn.classList.remove('active');
            }
        }

        // Update entity selector class
        var select = document.getElementById('calendar-entity-select');
        if (select) {
            select.className = getEntitySelectorClass(mode);
        }

        renderActiveMode();
        populateEntitySelector();
        updateWeekDisplay();
        saveState();
    }

    function switchWeek(delta) {
        var newWeek = _state.week + delta;
        if (newWeek < MIN_WEEK) { newWeek = MIN_WEEK; }
        if (newWeek > MAX_WEEK) { newWeek = MAX_WEEK; }
        if (newWeek === _state.week) { return; }

        _state.week = newWeek;

        var ui = getModeUI(_state.mode);
        if (ui && ui.setState) {
            ui.setState({ week: newWeek });
        }

        updateWeekDisplay();
        saveState();
    }

    function selectEntity(entityId) {
        if (entityId === _state.selectedId) { return; }
        _state.selectedId = entityId;

        var ui = getModeUI(_state.mode);
        if (ui && ui.setState) {
            ui.setState({ selectedId: entityId });
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

    // ============================================================
    // EVENT BINDING
    // ============================================================

    function bindEvents() {
        if (!_container) { return; }

        var modeButtons = _container.querySelectorAll('.mode-btn');
        for (var i = 0; i < modeButtons.length; i++) {
            var btn = modeButtons[i];
            addTrackedListener(btn, 'click', function() {
                var mode = this.dataset.mode;
                if (mode) { switchMode(mode); }
            });
        }

        var prevBtn = document.getElementById('calendar-prev-week');
        if (prevBtn) {
            addTrackedListener(prevBtn, 'click', function() { switchWeek(-1); });
        }

        var nextBtn = document.getElementById('calendar-next-week');
        if (nextBtn) {
            addTrackedListener(nextBtn, 'click', function() { switchWeek(1); });
        }

        var entitySelect = document.getElementById('calendar-entity-select');
        if (entitySelect) {
            addTrackedListener(entitySelect, 'change', function() {
                var id = this.value;
                if (id) { selectEntity(id); }
            });
        }
    }

    function destroyUI() {
        if (_activeUI && typeof _activeUI.destroy === 'function') {
            try {
                _activeUI.destroy();
            } catch (e) {
                // Ignore destroy errors
            }
        }
        _activeUI = null;

        removeAllTrackedListeners();

        _initialized = false;
    }

    // ============================================================
    // PUBLIC API
    // ============================================================

    function destroy() {
        destroyUI();
        _container = null;
    }

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
            switchMode(newState.mode);
            changed = true;
        }
        if (newState.week !== undefined && newState.week !== _state.week) {
            var week = parseInt(newState.week, 10);
            if (!isNaN(week) && week >= MIN_WEEK && week <= MAX_WEEK) {
                _state.week = week;
                var ui = getModeUI(_state.mode);
                if (ui && ui.setState) { ui.setState({ week: week }); }
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

    // ============================================================
    // REGISTER WITH TABMANAGER
    // ============================================================

    if (TabManager && typeof TabManager.register === 'function') {
        TabManager.register('calendar', render);
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.CalendarModule = {
        render: render,
        destroy: destroy,
        refresh: refresh,
        switchMode: switchMode,
        switchWeek: switchWeek,
        selectEntity: selectEntity,
        getState: getState,
        setState: setState
    };

    // Legacy aliases
    window.renderCalendar = render;
    window.destroyCalendar = destroy;

})();
