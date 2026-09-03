/**
 * utils/form-utils.js - Form Utilities
 * 
 * Path: js/utils/form-utils.js
 * 
 * This module provides:
 *   - getField / setField - Individual field operations
 *   - getFormData / setFormData - Full form operations
 *   - resetForm - Form reset
 *   - Validation helpers (required, number, integer, range)
 * 
 * IMPORTANT:
 *   - Moved from dom-utils.js
 *   - No DOM manipulation beyond reading/writing form values
 *   - Consistent checkbox/radio semantics
 */

(function() {
    'use strict';

    if (window.__formUtilsLoaded) return;
    window.__formUtilsLoaded = true;

    // ============================================================
    // FIELD OPERATIONS
    // ============================================================

    function getField(id) {
        var el = document.getElementById(id);
        if (!el) return null;

        if (el.type === 'checkbox') {
            return el.checked;
        }

        if (el.type === 'radio') {
            return el.checked;
        }

        if (el.tagName === 'SELECT' && el.multiple) {
            var values = [];
            for (var i = 0; i < el.options.length; i++) {
                if (el.options[i].selected) {
                    values.push(el.options[i].value);
                }
            }
            return values;
        }

        return el.value;
    }

    function setField(id, value) {
        var el = document.getElementById(id);
        if (!el) return;

        if (el.type === 'checkbox') {
            el.checked = !!value;
            return;
        }

        if (el.type === 'radio') {
            el.checked = String(el.value) === String(value);
            return;
        }

        if (el.tagName === 'SELECT' && el.multiple) {
            if (Array.isArray(value)) {
                for (var i = 0; i < el.options.length; i++) {
                    el.options[i].selected = value.indexOf(el.options[i].value) !== -1;
                }
            }
            return;
        }

        el.value = value !== undefined && value !== null ? value : '';
    }

    // ============================================================
    // FORM DATA OPERATIONS
    // ============================================================

    function getFormData(form) {
        if (!form) return {};

        var data = {};
        var elements = form.elements;
        var radioGroups = Object.create(null);
        var checkboxGroups = Object.create(null);

        for (var i = 0; i < elements.length; i++) {
            var el = elements[i];
            if (!el.name) continue;

            if (el.type === 'radio') {
                if (!radioGroups[el.name]) {
                    radioGroups[el.name] = { selected: null, found: false };
                }
                if (el.checked) {
                    radioGroups[el.name].selected = el.value;
                    radioGroups[el.name].found = true;
                }
                continue;
            }

            if (el.type === 'checkbox') {
                if (!checkboxGroups[el.name]) {
                    checkboxGroups[el.name] = { count: 0, values: [] };
                }
                checkboxGroups[el.name].count++;
                if (el.checked) {
                    checkboxGroups[el.name].values.push(el.value);
                }
                continue;
            }

            if (el.tagName === 'SELECT' && el.multiple) {
                var values = [];
                for (var j = 0; j < el.options.length; j++) {
                    if (el.options[j].selected) {
                        values.push(el.options[j].value);
                    }
                }
                data[el.name] = values;
                continue;
            }

            data[el.name] = el.value;
        }

        for (var name in radioGroups) {
            if (Object.prototype.hasOwnProperty.call(radioGroups, name)) {
                data[name] = radioGroups[name].selected;
            }
        }

        for (var name in checkboxGroups) {
            if (Object.prototype.hasOwnProperty.call(checkboxGroups, name)) {
                var group = checkboxGroups[name];
                if (group.count === 1) {
                    data[name] = group.values.length > 0;
                } else {
                    data[name] = group.values;
                }
            }
        }

        return data;
    }

    function setFormData(form, data) {
        if (!form || !data) return;

        var elements = form.elements;

        for (var i = 0; i < elements.length; i++) {
            var el = elements[i];
            if (!el.name) continue;
            if (!(el.name in data)) continue;

            var value = data[el.name];

            if (el.type === 'radio') {
                el.checked = String(el.value) === String(value);
                continue;
            }

            if (el.type === 'checkbox') {
                if (Array.isArray(value)) {
                    el.checked = value.indexOf(el.value) !== -1;
                } else {
                    el.checked = !!value;
                }
                continue;
            }

            if (el.tagName === 'SELECT' && el.multiple) {
                if (Array.isArray(value)) {
                    for (var j = 0; j < el.options.length; j++) {
                        el.options[j].selected = value.indexOf(el.options[j].value) !== -1;
                    }
                }
                continue;
            }

            el.value = value !== undefined && value !== null ? value : '';
        }
    }

    function resetForm(form) {
        if (!form) return;
        form.reset();
    }

    // ============================================================
    // VALIDATION HELPERS
    // ============================================================

    function validateRequired(id) {
        var value = getField(id);

        if (value === null || value === undefined) return false;
        if (typeof value === 'boolean') return value;
        if (Array.isArray(value)) return value.length > 0;
        return String(value).trim() !== '';
    }

    function validateNumber(id) {
        var value = getField(id);
        if (value === null || value === undefined || value === '') return false;
        return !isNaN(Number(value));
    }

    function validateInteger(id) {
        var value = getField(id);
        if (value === null || value === undefined || value === '') return false;
        return Number.isInteger(Number(value));
    }

    function validateRange(id, min, max) {
        var value = getField(id);
        if (value === null || value === undefined || value === '') return false;
        var num = Number(value);
        return !isNaN(num) && num >= min && num <= max;
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.FormUtils = {
        getField: getField,
        setField: setField,
        getFormData: getFormData,
        setFormData: setFormData,
        resetForm: resetForm,
        validateRequired: validateRequired,
        validateNumber: validateNumber,
        validateInteger: validateInteger,
        validateRange: validateRange
    };

})();
