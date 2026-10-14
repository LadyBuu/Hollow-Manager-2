/**
 * utils/form-utils.js - Form Utilities
 *
 * Path: js/utils/form-utils.js
 *
 * This module provides:
 *   - getField / setField           - Single control operations
 *   - getFormData / setFormData     - Whole-form operations
 *   - resetForm
 *   - validateRequired / validateNumber / validateInteger / validateRange
 *
 * IMPORTANT:
 *   - Presentation validation only. Domain validation belongs in
 *     the domain modules, not here.
 *   - No side effects beyond reading, writing, and dispatching
 *     change/input events on form controls.
 *   - Consistent checkbox/radio semantics (see below).
 *
 * DISABLED CONTROLS:
 *   Disabled controls are SKIPPED by getFormData and setFormData.
 *   This matches native form-submission semantics and the FormData
 *   API. Callers that want disabled values should read them with
 *   getField() explicitly.
 *
 * EVENT DISPATCH:
 *   setField and setFormData dispatch 'input' and 'change' events
 *   on each modified control, so listener-based UI updates. Pass
 *   { silent: true } as the options argument to suppress this for
 *   bulk updates where per-field events are unwanted (e.g. initial
 *   form population).
 *
 * CHECKBOX GROUP SHAPE:
 *   getFormData returns an ARRAY for every checkbox group, even
 *   one with a single checkbox. This is deterministic and matches
 *   FormData. Previously the shape depended on how many checkboxes
 *   happened to be rendered, which produced `true` for a single
 *   checkbox and `['x']` for a group, breaking callers that did
 *   `Array.isArray(data.foo)`.
 *
 *   To opt into boolean for a single checkbox, add the attribute
 *   `data-single` to the checkbox's element. The inverse,
 *   `data-multi`, is accepted but has no effect on the array
 *   default. This is the recommended path for callers that want a
 *   boolean.
 *
 * SET FORMDATA AND STALE STATE:
 *   setFormData calls form.reset() first by default, so any field
 *   NOT present in the data object is cleared. Without this,
 *   loading record B into a form that previously held record A
 *   keeps A's values for every field B lacks. Pass
 *   { reset: false } to disable this and perform a partial update.
 *
 * RADIO AND CHECKBOX:
 *   getFormData:
 *     - radio group    -> the checked value as a string, or null
 *     - checkbox group -> array of checked values (see above)
 *   setFormData:
 *     - radio group    -> set the radio whose value matches
 *     - checkbox group -> check the values in the array
 *   getField / setField operate on ONE control. For radio groups,
 *   use getFormData / setFormData.
 *
 * NUMBER PARSING:
 *   validateNumber, validateInteger, and validateRange use
 *   ValidationUtils.parseOptionalInteger when available, and a
 *   matching local implementation otherwise. This rejects '0x10',
 *   '1e3', '5.0', signed strings, and whitespace-only strings. It
 *   is consistent with ValidationUtils, CalendarValidation, and
 *   FormatUtils, so a field that validates will also parse.
 *
 * DEPENDENCIES:
 *   - window.ValidationUtils (optional; a local implementation is
 *     used if absent)
 */

(function() {
    'use strict';

    if (window.__formUtilsLoaded) return;
    window.__formUtilsLoaded = true;

    // ============================================================
    // HELPERS
    // ============================================================

    function getValidationUtils() {
        return window.ValidationUtils;
    }

    function isDisabled(el) {
        if (!el) return false;
        if (el.disabled) return true;
        // A control inside a disabled fieldset is also disabled
        // per HTML spec.
        var parent = el.parentElement;
        while (parent) {
            if (parent.tagName === 'FIELDSET' && parent.disabled) {
                return true;
            }
            parent = parent.parentElement;
        }
        return false;
    }

    function isExcluded(el) {
        if (!el || !el.tagName) return true;
        var tag = el.tagName;
        if (tag === 'BUTTON') return true;
        if (tag === 'FIELDSET') return true;
        if (tag === 'OUTPUT') return true;
        return false;
    }

    function dispatchChangeEvents(el, silent) {
        if (silent || !el || typeof el.dispatchEvent !== 'function') {
            return;
        }
        try {
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
        } catch (e) {
            // Older environments without Event constructor; skip.
        }
    }

    function warn(message) {
        if (typeof console !== 'undefined' && console.warn) {
            console.warn('[FormUtils] ' + message);
        }
    }

    // ============================================================
    // FIELD OPERATIONS
    // ============================================================

    /**
     * Get a form field value.
     *
     * SEMANTICS:
     *   - Single checkbox: boolean (true/false)
     *   - Radio button: boolean for THAT SPECIFIC radio
     *   - Multi-select: array of selected values
     *   - All other inputs: string value
     *
     * NOTE: For radio groups, use getFormData() instead. Disabled
     * controls are NOT skipped here; use getFormData if you want
     * the disabled-skip behaviour.
     *
     * @param {string} id - Element ID
     * @returns {*} Field value, or null if element not found
     */
    function getField(id) {
        var el = document.getElementById(id);
        if (!el) {
            warn('getField: no element with id "' + id + '"');
            return null;
        }

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

    /**
     * Set a form field value.
     *
     * SEMANTICS:
     *   - Single checkbox: treats value as boolean; also accepts
     *     the strings 'true' / 'false' (matches JSON / form
     *     round-trip shapes).
     *   - Radio button: sets checked state for THAT SPECIFIC radio.
     *   - Multi-select: treats value as an array of strings.
     *   - Other inputs: sets string value.
     *
     * Dispatches 'input' and 'change' events unless { silent: true }.
     *
     * @param {string} id - Element ID
     * @param {*} value - Value to set
     * @param {object} [options] - { silent: boolean }
     */
    function setField(id, value, options) {
        options = options || {};
        var silent = options.silent === true;

        var el = document.getElementById(id);
        if (!el) {
            warn('setField: no element with id "' + id + '"');
            return;
        }

        if (el.type === 'checkbox') {
            el.checked = coerceBoolean(value);
            dispatchChangeEvents(el, silent);
            return;
        }

        if (el.type === 'radio') {
            el.checked = String(el.value) === String(value);
            dispatchChangeEvents(el, silent);
            return;
        }

        if (el.tagName === 'SELECT' && el.multiple) {
            if (Array.isArray(value)) {
                for (var i = 0; i < el.options.length; i++) {
                    el.options[i].selected =
                        value.indexOf(el.options[i].value) !== -1;
                }
                dispatchChangeEvents(el, silent);
            }
            return;
        }

        if (el.tagName === 'SELECT') {
            var wanted = value !== undefined && value !== null ? String(value) : '';
            var matched = false;
            for (var j = 0; j < el.options.length; j++) {
                if (el.options[j].value === wanted) {
                    matched = true;
                    break;
                }
            }
            if (!matched && wanted !== '') {
                warn(
                    'setField: no option with value "' + wanted +
                    '" in select "' + id + '"'
                );
                return;
            }
            el.value = wanted;
            dispatchChangeEvents(el, silent);
            return;
        }

        el.value = value !== undefined && value !== null ? value : '';
        dispatchChangeEvents(el, silent);
    }

    /**
     * Coerce a value to boolean for checkbox use.
     * Handles the string forms 'true' / 'false' that come back from
     * JSON or localStorage round trips.
     */
    function coerceBoolean(value) {
        if (typeof value === 'string') {
            if (value === 'false') return false;
            if (value === 'true') return true;
        }
        return !!value;
    }

    // ============================================================
    // FORM DATA OPERATIONS
    // ============================================================

    /**
     * Get all form data as an object.
     *
     * Skips disabled controls and button/fieldset elements.
     * Checkbox groups always produce an array (see header).
     *
     * @param {HTMLFormElement} form
     * @returns {object}
     */
    function getFormData(form) {
        if (!form) return {};

        var data = {};
        var elements = form.elements;
        var radioGroups = Object.create(null);
        var checkboxGroups = Object.create(null);
        var seenNames = Object.create(null);

        for (var i = 0; i < elements.length; i++) {
            var el = elements[i];

            if (isExcluded(el)) continue;
            if (isDisabled(el)) continue;
            if (!el.name) continue;

            if (el.type === 'radio') {
                if (!radioGroups[el.name]) {
                    radioGroups[el.name] = { selected: null };
                }
                if (el.checked) {
                    radioGroups[el.name].selected = el.value;
                }
                continue;
            }

            if (el.type === 'checkbox') {
                if (!checkboxGroups[el.name]) {
                    checkboxGroups[el.name] = {
                        values: [],
                        single: el.hasAttribute('data-single')
                    };
                }
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
                if (seenNames[el.name]) {
                    warn('getFormData: duplicate name "' + el.name + '"');
                }
                seenNames[el.name] = true;
                data[el.name] = values;
                continue;
            }

            if (seenNames[el.name]) {
                warn('getFormData: duplicate name "' + el.name + '"');
            }
            seenNames[el.name] = true;
            data[el.name] = el.value;
        }

        var name;
        for (name in radioGroups) {
            if (Object.prototype.hasOwnProperty.call(radioGroups, name)) {
                data[name] = radioGroups[name].selected;
            }
        }

        for (name in checkboxGroups) {
            if (Object.prototype.hasOwnProperty.call(checkboxGroups, name)) {
                var group = checkboxGroups[name];
                if (group.single) {
                    data[name] = group.values.length > 0;
                } else {
                    data[name] = group.values;
                }
            }
        }

        return data;
    }

    /**
     * Set form data from an object.
     *
     * By default, form.reset() is called first, so fields absent
     * from `data` are cleared. Pass { reset: false } for a partial
     * update.
     *
     * Skips disabled controls. Dispatches 'input' and 'change'
     * events unless { silent: true }.
     *
     * @param {HTMLFormElement} form
     * @param {object} data
     * @param {object} [options] - { reset: boolean, silent: boolean }
     */
    function setFormData(form, data, options) {
        if (!form || !data) return;

        options = options || {};
        var doReset = options.reset !== false;
        var silent = options.silent === true;

        if (doReset) {
            form.reset();
        }

        var elements = form.elements;
        var handledGroups = Object.create(null);

        for (var i = 0; i < elements.length; i++) {
            var el = elements[i];

            if (isExcluded(el)) continue;
            if (isDisabled(el)) continue;
            if (!el.name) continue;

            if (el.type === 'radio') {
                if (!Object.prototype.hasOwnProperty.call(data, el.name)) {
                    continue;
                }
                el.checked = String(el.value) === String(data[el.name]);
                if (!handledGroups[el.name]) {
                    handledGroups[el.name] = true;
                }
                dispatchChangeEvents(el, silent);
                continue;
            }

            if (el.type === 'checkbox') {
                if (!handledGroups[el.name]) {
                    handledGroups[el.name] = true;

                    var value = Object.prototype.hasOwnProperty.call(data, el.name)
                        ? data[el.name]
                        : undefined;

                    // Clear every checkbox in the group first, then
                    // check the ones that should be checked. This
                    // handles both "data omitted the key" (all
                    // unchecked) and "data listed a subset".
                    var isArray = Array.isArray(value);
                    var isBool = typeof value === 'boolean';

                    for (var k = 0; k < elements.length; k++) {
                        var cb = elements[k];
                        if (cb.type !== 'checkbox' || cb.name !== el.name) continue;
                        if (isDisabled(cb)) continue;

                        var shouldCheck;
                        if (isArray) {
                            shouldCheck = value.indexOf(cb.value) !== -1;
                        } else if (isBool) {
                            shouldCheck = value;
                        } else if (typeof value === 'string') {
                            shouldCheck = coerceBoolean(value);
                        } else if (value === undefined || value === null) {
                            // Absent: unchecked (form.reset() may
                            // have already cleared this if defaults
                            // allow it).
                            shouldCheck = false;
                        } else {
                            shouldCheck = !!value;
                        }

                        cb.checked = shouldCheck;
                        dispatchChangeEvents(cb, silent);
                    }
                }
                continue;
            }

            if (!Object.prototype.hasOwnProperty.call(data, el.name)) {
                continue;
            }

            var fieldValue = data[el.name];

            if (el.tagName === 'SELECT' && el.multiple) {
                if (Array.isArray(fieldValue)) {
                    for (var m = 0; m < el.options.length; m++) {
                        el.options[m].selected =
                            fieldValue.indexOf(el.options[m].value) !== -1;
                    }
                    dispatchChangeEvents(el, silent);
                }
                continue;
            }

            el.value = fieldValue !== undefined && fieldValue !== null
                ? fieldValue
                : '';
            dispatchChangeEvents(el, silent);
        }
    }

    function resetForm(form) {
        if (!form) return;
        form.reset();
    }

    // ============================================================
    // VALIDATION HELPERS
    // ============================================================

    /**
     * Validate that a field has a value.
     *
     * SEMANTICS:
     *   - String: non-empty after trimming
     *   - Boolean: true (for checkboxes)
     *   - Array: at least one element selected
     *   - Number input (type="number"): value must not be NaN
     *
     * Radio groups must be validated with getFormData, not this
     * function, because getField returns a per-radio boolean.
     *
     * @param {string} id
     * @returns {boolean}
     */
    function validateRequired(id) {
        var el = document.getElementById(id);
        if (!el) return false;

        if (el.type === 'number') {
            return typeof el.valueAsNumber === 'number' &&
                   !isNaN(el.valueAsNumber);
        }

        var value = getField(id);

        if (value === null || value === undefined) {
            return false;
        }

        if (typeof value === 'boolean') {
            return value;
        }

        if (Array.isArray(value)) {
            return value.length > 0;
        }

        return String(value).trim() !== '';
    }

    /**
     * Validate that a field is a finite number.
     * Delegates to ValidationUtils.parseOptionalInteger... no, to
     * a range check with a strict numeric parse.
     */
    function validateNumber(id) {
        var el = document.getElementById(id);
        if (!el) return false;

        if (el.type === 'number') {
            return typeof el.valueAsNumber === 'number' &&
                   isFinite(el.valueAsNumber);
        }

        var str = String(el.value === undefined || el.value === null
            ? ''
            : el.value).trim();
        if (str === '') return false;

        var num = Number(str);
        return isFinite(num);
    }

    /**
     * Validate that a field is a finite integer.
     * Rejects '0x10', '1e3', '5.0', and whitespace-only strings,
     * matching ValidationUtils.parseOptionalInteger.
     */
    function validateInteger(id) {
        var el = document.getElementById(id);
        if (!el) return false;

        if (el.type === 'number') {
            return typeof el.valueAsNumber === 'number' &&
                   isFinite(el.valueAsNumber) &&
                   Number.isInteger(el.valueAsNumber);
        }

        var value = el.value;
        if (value === undefined || value === null || value === '') {
            return false;
        }

        var VU = getValidationUtils();
        if (VU && typeof VU.parseOptionalInteger === 'function') {
            return VU.parseOptionalInteger(value) !== null;
        }

        var str = String(value).trim();
        if (str === '' || !/^\d+$/.test(str)) {
            return false;
        }
        var num = Number(str);
        return Number.isSafeInteger(num);
    }

    /**
     * Validate that a field is a finite number in a range.
     *
     * @param {string} id
     * @param {number} min
     * @param {number} max
     * @returns {boolean}
     * @throws {Error} If min or max is not a finite number.
     */
    function validateRange(id, min, max) {
        if (typeof min !== 'number' || !isFinite(min)) {
            throw new Error('validateRange: min must be a finite number');
        }
        if (typeof max !== 'number' || !isFinite(max)) {
            throw new Error('validateRange: max must be a finite number');
        }

        var el = document.getElementById(id);
        if (!el) return false;

        var num;
        if (el.type === 'number') {
            num = el.valueAsNumber;
            if (typeof num !== 'number' || !isFinite(num)) {
                return false;
            }
        } else {
            var str = String(el.value === undefined || el.value === null
                ? ''
                : el.value).trim();
            if (str === '') return false;
            num = Number(str);
            if (!isFinite(num)) return false;
        }

        return num >= min && num <= max;
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.FormUtils = Object.freeze({
        getField: getField,
        setField: setField,
        getFormData: getFormData,
        setFormData: setFormData,
        resetForm: resetForm,
        validateRequired: validateRequired,
        validateNumber: validateNumber,
        validateInteger: validateInteger,
        validateRange: validateRange
    });

})();
