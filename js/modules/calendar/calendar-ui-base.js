/**
 * modules/calendar/calendar-ui-base.js - Calendar UI Base
 * Tiny shared UI helpers for calendar modules
 * 
 * IMPORTANT:
 *   - Keep this TINY - only share what's genuinely duplicated
 *   - Generic DOM helpers go to DomUtils
 *   - Notifications go to NotificationSystem
 *   - Modals go to Modal
 * 
 * CONTENTS:
 *   - addEventListener / removeAllEventListeners
 *   - escapeHtml / escapeAttribute (delegate to DomUtils)
 *   - notify (delegate to NotificationSystem)
 *   - Common Calendar UI state helpers
 * 
 * DOES NOT CONTAIN:
 *   - Modal workflows (Student/Instructor/Location specific)
 *   - Domain logic
 *   - External domain resolution
 * 
 * DEPENDENCIES:
 *   - DomUtils
 *   - NotificationSystem
 *   - Modal
 */

(function() {
    'use strict';

    if (window.__calendarUIBaseLoaded) { return; }
    window.__calendarUIBaseLoaded = true;

    var DomUtils = window.DomUtils;
    var NotificationSystem = window.NotificationSystem;
    var Modal = window.Modal;

    // ============================================================
    // HTML ESCAPING
    // ============================================================

    function escapeHtml(value) {
        return DomUtils.escapeHtml(value);
    }

    function escapeAttribute(value) {
        if (typeof DomUtils.escapeAttribute === 'function') {
            return DomUtils.escapeAttribute(value);
        }
        return String(value == null ? '' : value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
    }

    // ============================================================
    // NOTIFICATIONS
    // ============================================================

    function notify(message, type) {
        type = type || 'info';
        if (NotificationSystem && typeof NotificationSystem.notify === 'function') {
            NotificationSystem.notify(message, type);
        }
    }

    // ============================================================
    // EVENT LISTENERS
    // ============================================================

    function addEventListener(element, eventName, handler, options) {
        if (!element) { return; }
        element.addEventListener(eventName, handler, options || false);
        return {
            element: element,
            eventName: eventName,
            handler: handler,
            options: options || false
        };
    }

    function removeAllEventListeners(listeners) {
        if (!Array.isArray(listeners)) { return; }
        for (var i = 0; i < listeners.length; i++) {
            var item = listeners[i];
            try {
                item.element.removeEventListener(item.eventName, item.handler, item.options);
            } catch (e) {
                // Ignore errors during cleanup
            }
        }
        listeners.length = 0;
    }

    // ============================================================
    // MODAL HELPERS
    // ============================================================

    function createModal(className) {
        if (Modal && typeof Modal.createModal === 'function') {
            return Modal.createModal(className);
        }
        return null;
    }

    function showModal(modal) {
        if (Modal && typeof Modal.showModal === 'function') {
            Modal.showModal(modal);
        }
    }

    function closeModal(modal) {
        if (Modal && typeof Modal.closeModal === 'function') {
            Modal.closeModal(modal);
        }
    }

    function modalSetup(modal, onClose) {
        if (Modal && typeof Modal.modalSetup === 'function') {
            Modal.modalSetup(modal, onClose);
        }
    }

    // ============================================================
    // UI STATE HELPERS
    // ============================================================

    function getSelectedIdFromSelect(selectElement) {
        if (!selectElement) { return null; }
        return selectElement.value || null;
    }

    function populateSelect(selectElement, items, getValue, getLabel, selectedId) {
        if (!selectElement) { return; }
        selectElement.innerHTML = '<option value="">Select...</option>';
        for (var i = 0; i < items.length; i++) {
            var item = items[i];
            var value = getValue ? getValue(item) : item.id;
            var label = getLabel ? getLabel(item) : (item.name || item.label || value);
            var option = document.createElement('option');
            option.value = value;
            option.textContent = label;
            if (String(value) === String(selectedId)) { option.selected = true; }
            selectElement.appendChild(option);
        }
    }

    function getCheckboxValues(container, selector) {
        var checkboxes = container.querySelectorAll(selector);
        var values = [];
        for (var i = 0; i < checkboxes.length; i++) {
            if (checkboxes[i].checked) {
                var val = checkboxes[i].value;
                if (val) { values.push(val); }
            }
        }
        return values;
    }

    window.CalendarUIBase = {
        // HTML escaping
        escapeHtml: escapeHtml,
        escapeAttribute: escapeAttribute,

        // Notifications
        notify: notify,

        // Event listeners
        addEventListener: addEventListener,
        removeAllEventListeners: removeAllEventListeners,

        // Modal
        createModal: createModal,
        showModal: showModal,
        closeModal: closeModal,
        modalSetup: modalSetup,

        // UI state helpers
        getSelectedIdFromSelect: getSelectedIdFromSelect,
        populateSelect: populateSelect,
        getCheckboxValues: getCheckboxValues
    };

})();
