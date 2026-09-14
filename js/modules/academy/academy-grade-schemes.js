/**
 * modules/academy/academy-grade-schemes.js - Academy Grade Schemes
 * Pure grading-scheme definitions, presets, and conversions.
 *
 * Path: js/modules/academy/academy-grade-schemes.js
 *
 * This module is responsible for:
 *   - Providing the built-in grade scheme presets (Letter, Pass/Fail, Numeric)
 *   - Normalising scheme objects to a canonical shape
 *   - Validating scheme objects (bands sorted, unique labels, minPercent in range)
 *   - Converting a percentage to a band label for display
 *   - Producing a human-readable range preview for the discipline editor
 *   - Providing passing semantics (default threshold or scheme-aware)
 *   - Providing letter-grade semantics (default letter map or scheme-aware)
 *
 * IMPORTANT:
 *   - PURE. No DOM, no persistence, no queries. Constants + functions only.
 *   - Schemes are FULLY user-editable. Presets only seed the bands array;
 *     after that, the stored scheme is the source of truth.
 *   - Grades are ALWAYS stored as percentages. The scheme is a display layer.
 *     Nothing about the converted label is persisted.
 *   - The 'numeric' scheme means "no conversion": display the raw percentage.
 *     Callers detect this by checking `scheme.id === 'numeric'` OR by looking
 *     for the sentinel band label '%'.
 *
 * SCHEME SHAPE:
 *   {
 *     id:        string,   // preset marker: 'letter' | 'pass_fail' | 'numeric' | 'custom'
 *     label:     string,   // display name, user-editable
 *     bands: [
 *       { label: string, minPercent: integer 0..100 },
 *       ...
 *     ]
 *   }
 *
 * BAND SEMANTICS:
 *   - Bands are sorted DESCENDING by minPercent.
 *   - The band whose minPercent is the largest value <= score wins.
 *   - The lowest band MUST have minPercent === 0 so every score matches.
 *   - Bands must have unique labels (case-sensitive).
 *
 * PASSING SEMANTICS:
 *   - isPassing(score, scheme):
 *       * If scheme is provided AND is not the numeric scheme, uses the
 *         scheme's bands to determine passing. A score passes if its
 *         matching band's minPercent is >= the scheme's "lowest passing
 *         band" threshold. The lowest passing band is the last band in
 *         the scheme whose label is not in a fail-label set.
 *       * If scheme is not provided, uses PASSING_THRESHOLD (70).
 *       * If scheme is the numeric scheme, uses PASSING_THRESHOLD.
 *   - FAIL_LABELS: labels considered failing by convention. Used to
 *     determine the lowest passing band. Defaults to ['F', 'Fail'].
 *     Users can rename bands, so this is heuristic — callers who need
 *     exact control should read bands directly.
 *
 * LETTER GRADE SEMANTICS:
 *   - getLetterGrade(score, scheme):
 *       * If scheme is provided AND is not the numeric scheme, returns
 *         the matching band's label (as both label and description).
 *       * Otherwise, falls back to LETTER_GRADES (A/B/C/D/F at 90/80/70/60/0).
 *
 * DEPENDENCIES:
 *   - None (self-contained)
 *
 * USAGE:
 *   var S = window.AcademyGradeSchemes;
 *   var preset = S.getPreset('letter');
 *   var scheme = S.normalizeScheme(rawScheme);
 *   var label = S.getLabelForScore(scheme, 87);       // → 'B'
 *   var preview = S.getRangeLabel(scheme);             // → 'A: 90–100%, B: 80–89%, ...'
 *   var passed = S.isPassing(87, scheme);              // → true
 *   var letter = S.getLetterGrade(87, scheme);         // → { label: 'B', description: 'B' }
 */

(function() {
    'use strict';

    if (window.__academyGradeSchemesLoaded) {
        return;
    }
    window.__academyGradeSchemesLoaded = true;

    // ============================================================
    // CONSTANTS
    // ============================================================

    var VALID_PRESET_IDS = ['letter', 'pass_fail', 'numeric', 'custom'];
    var DEFAULT_PRESET_ID = 'numeric';
    var NUMERIC_SENTINEL_LABEL = '%';

    var MIN_PERCENT = 0;
    var MAX_PERCENT = 100;
    var MAX_BANDS = 26;
    var MAX_LABEL_LENGTH = 12;
    var MAX_SCHEME_LABEL_LENGTH = 40;

    // ---- Passing ----
    var PASSING_THRESHOLD = 70;

    // Labels considered failing by convention. Used by isPassing to
    // locate the "lowest passing band" in a custom scheme. Case-sensitive
    // matching against the scheme's band labels.
    var FAIL_LABELS = Object.freeze(['F', 'Fail']);

    // ---- Letter-grade fallback map ----
    // Used by getLetterGrade when no scheme is provided. This is the
    // canonical default; schemes override it.
    var LETTER_GRADES = Object.freeze([
        { min: 90, label: 'A', description: 'Excellent' },
        { min: 80, label: 'B', description: 'Good' },
        { min: 70, label: 'C', description: 'Satisfactory' },
        { min: 60, label: 'D', description: 'Below Average' },
        { min: 0,  label: 'F', description: 'Failing' }
    ]);

    // ============================================================
    // PRESETS
    // ============================================================
    //
    // A preset is a fully-formed scheme object. The editor copies it
    // verbatim when the user picks it from the dropdown. After that,
    // the stored scheme is authoritative — we never re-derive from
    // the preset id.

    var PRESETS = [
        {
            id: 'letter',
            label: 'Letter Grade',
            bands: [
                { label: 'A', minPercent: 90 },
                { label: 'B', minPercent: 80 },
                { label: 'C', minPercent: 70 },
                { label: 'D', minPercent: 60 },
                { label: 'F', minPercent: 0 }
            ]
        },
        {
            id: 'pass_fail',
            label: 'Pass / Fail',
            bands: [
                { label: 'Pass', minPercent: 70 },
                { label: 'Fail', minPercent: 0 }
            ]
        },
        {
            id: 'numeric',
            label: 'Numeric',
            bands: [
                { label: NUMERIC_SENTINEL_LABEL, minPercent: 0 }
            ]
        }
    ];

    // ============================================================
    // HELPERS
    // ============================================================

    function isObject(value) {
        return value !== null && typeof value === 'object' && !Array.isArray(value);
    }

    function isNonEmptyString(value) {
        return typeof value === 'string' && value.trim() !== '';
    }

    function deepFreeze(obj) {
        if (!obj || typeof obj !== 'object' || Object.isFrozen(obj)) {
            return obj;
        }
        var keys = Object.getOwnPropertyNames(obj);
        for (var i = 0; i < keys.length; i++) {
            var v = obj[keys[i]];
            if (v && typeof v === 'object') {
                deepFreeze(v);
            }
        }
        return Object.freeze(obj);
    }

    function deepClone(value) {
        if (value === null || typeof value !== 'object') {
            return value;
        }
        if (typeof structuredClone === 'function') {
            try { return structuredClone(value); } catch (_) {}
        }
        try { return JSON.parse(JSON.stringify(value)); } catch (_) { return value; }
    }

    // ============================================================
    // DEFAULTS
    // ============================================================

    /**
     * Get the default scheme (numeric, single sentinel band).
     * Returns a fresh copy so callers can't mutate the canonical.
     */
    function getDefaultScheme() {
        var numeric = getPreset('numeric');
        return deepClone(numeric);
    }

    /**
     * Is this scheme the numeric sentinel?
     * True when id === 'numeric' OR when the scheme has exactly one
     * band and that band's label is the numeric sentinel.
     */
    function isNumericScheme(scheme) {
        if (!scheme || typeof scheme !== 'object') { return false; }
        if (scheme.id === 'numeric') { return true; }
        if (Array.isArray(scheme.bands) && scheme.bands.length === 1) {
            var band = scheme.bands[0];
            if (band && band.label === NUMERIC_SENTINEL_LABEL) {
                return true;
            }
        }
        return false;
    }

    // ============================================================
    // PRESETS - lookup
    // ============================================================

    function getPresets() {
        var result = [];
        for (var i = 0; i < PRESETS.length; i++) {
            result.push(deepClone(PRESETS[i]));
        }
        return result;
    }

    function getPreset(id) {
        if (!isNonEmptyString(id)) { return null; }
        for (var i = 0; i < PRESETS.length; i++) {
            if (PRESETS[i].id === id) {
                return deepClone(PRESETS[i]);
            }
        }
        return null;
    }

    function isValidPresetId(id) {
        if (!isNonEmptyString(id)) { return false; }
        return VALID_PRESET_IDS.indexOf(id) !== -1;
    }

    function getValidPresetIds() {
        return VALID_PRESET_IDS.slice();
    }

    function getDefaultPresetId() {
        return DEFAULT_PRESET_ID;
    }

    function getNumericSentinelLabel() {
        return NUMERIC_SENTINEL_LABEL;
    }

    // ============================================================
    // VALIDATION
    // ============================================================

    /**
     * Validate a scheme.
     *
     * Returns { valid: boolean, errors: [ { field, message } ] }
     *
     * Checks:
     *   - scheme is an object
     *   - label is a non-empty string, <= MAX_SCHEME_LABEL_LENGTH
     *   - bands is a non-empty array, <= MAX_BANDS entries
     *   - each band has a non-empty string label, <= MAX_LABEL_LENGTH
     *   - band labels are unique within the scheme
     *   - each band has an integer minPercent in [0, 100]
     *   - no duplicate minPercent values
     *   - exactly one band has minPercent === 0
     */
    function validateScheme(scheme) {
        var errors = [];

        if (!isObject(scheme)) {
            errors.push({ field: '_root', message: 'Scheme must be an object.' });
            return { valid: false, errors: errors };
        }

        if (!isNonEmptyString(scheme.label)) {
            errors.push({ field: 'label', message: 'Scheme name is required.' });
        } else if (scheme.label.length > MAX_SCHEME_LABEL_LENGTH) {
            errors.push({
                field: 'label',
                message: 'Scheme name must be ' + MAX_SCHEME_LABEL_LENGTH + ' characters or fewer.'
            });
        }

        if (!Array.isArray(scheme.bands)) {
            errors.push({ field: 'bands', message: 'Bands must be an array.' });
            return { valid: false, errors: errors };
        }

        if (scheme.bands.length === 0) {
            errors.push({ field: 'bands', message: 'At least one band is required.' });
        }

        if (scheme.bands.length > MAX_BANDS) {
            errors.push({
                field: 'bands',
                message: 'At most ' + MAX_BANDS + ' bands are allowed.'
            });
        }

        var labelsSeen = {};
        var minPercentsSeen = {};
        var zeroCount = 0;

        for (var i = 0; i < scheme.bands.length; i++) {
            var band = scheme.bands[i];
            var idx = i + 1;

            if (!isObject(band)) {
                errors.push({
                    field: 'band_' + i,
                    message: 'Band ' + idx + ' must be an object.'
                });
                continue;
            }

            if (!isNonEmptyString(band.label)) {
                errors.push({
                    field: 'band_' + i,
                    message: 'Band ' + idx + ' label is required.'
                });
            } else if (band.label.length > MAX_LABEL_LENGTH) {
                errors.push({
                    field: 'band_' + i,
                    message: 'Band ' + idx + ' label must be ' +
                        MAX_LABEL_LENGTH + ' characters or fewer.'
                });
            } else if (labelsSeen[band.label] === true) {
                errors.push({
                    field: 'band_' + i,
                    message: 'Band labels must be unique ("' + band.label + '" is duplicated).'
                });
            } else {
                labelsSeen[band.label] = true;
            }

            var minP = parseInt(band.minPercent, 10);
            if (isNaN(minP) || minP < MIN_PERCENT || minP > MAX_PERCENT) {
                errors.push({
                    field: 'band_' + i,
                    message: 'Band ' + idx + ' min percent must be an integer between 0 and 100.'
                });
            } else {
                if (minP === 0) { zeroCount++; }
                if (minPercentsSeen[minP] === true) {
                    errors.push({
                        field: 'band_' + i,
                        message: 'Band ' + idx + ' shares a min percent with another band (' + minP + ').'
                    });
                }
                minPercentsSeen[minP] = true;
            }
        }

        if (scheme.bands.length > 0 && zeroCount === 0) {
            errors.push({
                field: 'bands',
                message: 'One band must have min percent 0 so every score matches.'
            });
        }

        if (zeroCount > 1) {
            errors.push({
                field: 'bands',
                message: 'Only one band may have min percent 0.'
            });
        }

        return { valid: errors.length === 0, errors: errors };
    }

    /**
     * Does this scheme pass validation?
     */
    function isValidScheme(scheme) {
        return validateScheme(scheme).valid;
    }

    // ============================================================
    // NORMALISATION
    // ============================================================
    //
    // Normalisation is LENIENT. It coerces what it can, drops what it
    // can't, and produces a canonical shape. Unlike validateScheme,
    // which reports every problem, normalizeScheme produces a usable
    // scheme or falls back to the numeric default.
    //
    // This is the function every read path should call before using
    // a stored scheme. It guarantees:
    //   - id is a valid preset id or 'custom'
    //   - label is a non-empty string
    //   - bands is a non-empty array
    //   - bands sorted descending by minPercent
    //   - each band has a non-empty string label and integer minPercent 0..100
    //   - band labels unique (later duplicates dropped)
    //   - exactly one band with minPercent === 0 (added if missing)
    //   - returned object is frozen

    function normalizeScheme(raw) {
        if (!isObject(raw)) {
            return deepFreeze(getDefaultScheme());
        }

        var id = isValidPresetId(raw.id) ? raw.id : 'custom';
        var label = isNonEmptyString(raw.label)
            ? String(raw.label).trim().slice(0, MAX_SCHEME_LABEL_LENGTH)
            : 'Custom Scheme';

        var bands = [];

        if (Array.isArray(raw.bands)) {
            var labelsSeen = {};
            var minPercentsSeen = {};

            for (var i = 0; i < raw.bands.length && bands.length < MAX_BANDS; i++) {
                var band = raw.bands[i];
                if (!isObject(band)) { continue; }
                if (!isNonEmptyString(band.label)) { continue; }

                var bandLabel = String(band.label).trim().slice(0, MAX_LABEL_LENGTH);
                if (!bandLabel) { continue; }
                if (labelsSeen[bandLabel]) { continue; }

                var minP = parseInt(band.minPercent, 10);
                if (isNaN(minP)) { continue; }
                if (minP < MIN_PERCENT) { minP = MIN_PERCENT; }
                if (minP > MAX_PERCENT) { minP = MAX_PERCENT; }
                if (minPercentsSeen[minP]) { continue; }

                labelsSeen[bandLabel] = true;
                minPercentsSeen[minP] = true;
                bands.push({ label: bandLabel, minPercent: minP });
            }
        }

        // Sort descending by minPercent
        bands.sort(function(a, b) {
            return b.minPercent - a.minPercent;
        });

        // Ensure a band exists at minPercent 0
        var hasZero = false;
        for (var j = 0; j < bands.length; j++) {
            if (bands[j].minPercent === 0) { hasZero = true; break; }
        }
        if (!hasZero) {
            bands.push({ label: 'F', minPercent: 0 });
        }

        // If we somehow produced no bands, fall back to numeric sentinel.
        if (bands.length === 0) {
            return deepFreeze(getDefaultScheme());
        }

        return deepFreeze({
            id: id,
            label: label,
            bands: bands
        });
    }

    // ============================================================
    // CONVERSION
    // ============================================================

    /**
     * Get the band whose minPercent is the largest value <= percentage.
     * Returns null if no band matches (shouldn't happen after normalisation,
     * because every normalised scheme has a band at 0).
     */
    function getBandForScore(scheme, percentage) {
        if (!isObject(scheme) || !Array.isArray(scheme.bands)) {
            return null;
        }

        var score = Number(percentage);
        if (!isFinite(score)) { return null; }
        if (score < MIN_PERCENT) { score = MIN_PERCENT; }
        if (score > MAX_PERCENT) { score = MAX_PERCENT; }

        // Bands are sorted descending; first band whose minPercent <= score wins.
        for (var i = 0; i < scheme.bands.length; i++) {
            var band = scheme.bands[i];
            if (band && typeof band.minPercent === 'number' && score >= band.minPercent) {
                return band;
            }
        }

        // Fallback: the band with the lowest minPercent.
        var lowest = null;
        for (var j = 0; j < scheme.bands.length; j++) {
            var b = scheme.bands[j];
            if (!b || typeof b.minPercent !== 'number') { continue; }
            if (!lowest || b.minPercent < lowest.minPercent) {
                lowest = b;
            }
        }
        return lowest;
    }

    /**
     * Get the label for a percentage under a scheme.
     * Returns null for the numeric sentinel scheme (caller should
     * display the raw percentage instead).
     */
    function getLabelForScore(scheme, percentage) {
        if (!isObject(scheme)) { return null; }
        if (isNumericScheme(scheme)) { return null; }

        var band = getBandForScore(scheme, percentage);
        if (!band) { return null; }
        if (band.label === NUMERIC_SENTINEL_LABEL) { return null; }
        return band.label;
    }

    /**
     * Get a display string for a grade under a scheme.
     * For the numeric scheme, returns just the percentage.
     * For other schemes, returns "85% (B)".
     */
    function getGradeDisplay(scheme, percentage) {
        var pct = Math.round(Number(percentage));
        if (!isFinite(pct)) { return '\u2014'; }
        if (pct < MIN_PERCENT) { pct = MIN_PERCENT; }
        if (pct > MAX_PERCENT) { pct = MAX_PERCENT; }

        var pctStr = pct + '%';

        if (!isObject(scheme)) { return pctStr; }
        if (isNumericScheme(scheme)) { return pctStr; }

        var band = getBandForScore(scheme, pct);
        if (!band || band.label === NUMERIC_SENTINEL_LABEL) {
            return pctStr;
        }

        return pctStr + ' (' + band.label + ')';
    }

    // ============================================================
    // PASSING SEMANTICS
    // ============================================================

    /**
     * Get the lowest passing band's minPercent for a scheme.
     *
     * A "passing band" is any band whose label is not in FAIL_LABELS.
     * The lowest passing band is the one with the smallest minPercent
     * that is still considered passing.
     *
     * Returns null when:
     *   - scheme is missing or numeric
     *   - all bands are fail-labelled
     *
     * This is heuristic. Users can rename bands. If exact control is
     * needed, callers should inspect scheme.bands directly.
     */
    function getLowestPassingBand(scheme) {
        if (!isObject(scheme) || !Array.isArray(scheme.bands)) {
            return null;
        }
        if (isNumericScheme(scheme)) {
            return null;
        }

        var lowest = null;
        for (var i = 0; i < scheme.bands.length; i++) {
            var band = scheme.bands[i];
            if (!band || !isNonEmptyString(band.label)) { continue; }
            if (typeof band.minPercent !== 'number') { continue; }

            // Skip fail-labelled bands
            var isFail = FAIL_LABELS.indexOf(band.label) !== -1;
            if (isFail) { continue; }

            if (!lowest || band.minPercent < lowest.minPercent) {
                lowest = band;
            }
        }
        return lowest;
    }

    /**
     * Determine whether a score passes.
     *
     * SEMANTICS:
     *   - If scheme is provided and is NOT numeric:
     *       * Compute the lowest passing band's threshold.
     *       * Score passes iff its percentage >= that threshold.
     *   - Otherwise (scheme missing, or numeric):
     *       * Score passes iff percentage >= PASSING_THRESHOLD (70).
     *
     * @param {number} score - Percentage (0-100)
     * @param {object|null} scheme - Optional scheme
     * @returns {boolean} True if passing
     */
    function isPassing(score, scheme) {
        var pct = Number(score);
        if (!isFinite(pct)) { return false; }
        if (pct < MIN_PERCENT) { pct = MIN_PERCENT; }
        if (pct > MAX_PERCENT) { pct = MAX_PERCENT; }

        if (isObject(scheme) && !isNumericScheme(scheme)) {
            var lowestPassing = getLowestPassingBand(scheme);
            if (lowestPassing && typeof lowestPassing.minPercent === 'number') {
                return pct >= lowestPassing.minPercent;
            }
            // No passing band in the scheme (all fail). Nothing passes.
            return false;
        }

        return pct >= PASSING_THRESHOLD;
    }

    // ============================================================
    // LETTER-GRADE SEMANTICS
    // ============================================================

    /**
     * Get the letter grade for a score.
     *
     * SEMANTICS:
     *   - If scheme is provided and is NOT numeric:
     *       * Returns the matching band's label as both label and
     *         description. Description is intentionally identical
     *         because schemes only carry labels.
     *   - Otherwise:
     *       * Uses LETTER_GRADES (A=90, B=80, C=70, D=60, F=0).
     *
     * Return shape:
     *   { label: string, description: string }
     *
     * Callers that need "is this score passing under this scheme"
     * should use isPassing instead.
     *
     * @param {number} score - Percentage (0-100)
     * @param {object|null} scheme - Optional scheme
     * @returns {object} { label, description }
     */
    function getLetterGrade(score, scheme) {
        var pct = Number(score);
        if (!isFinite(pct)) {
            return { label: '?', description: 'Invalid' };
        }
        if (pct < MIN_PERCENT) { pct = MIN_PERCENT; }
        if (pct > MAX_PERCENT) { pct = MAX_PERCENT; }

        // Scheme-based path
        if (isObject(scheme) && !isNumericScheme(scheme)) {
            var band = getBandForScore(scheme, pct);
            if (band && isNonEmptyString(band.label)) {
                return {
                    label: band.label,
                    description: band.label
                };
            }
        }

        // Fallback: LETTER_GRADES
        for (var i = 0; i < LETTER_GRADES.length; i++) {
            if (pct >= LETTER_GRADES[i].min) {
                return {
                    label: LETTER_GRADES[i].label,
                    description: LETTER_GRADES[i].description
                };
            }
        }

        return { label: 'F', description: 'Failing' };
    }

    // ============================================================
    // DISPLAY HELPERS
    // ============================================================

    /**
     * Render a "A: 90–100, B: 80–89, ..." preview string for a scheme.
     * For the numeric sentinel, returns "Percentages as-is".
     */
    function getRangeLabel(scheme) {
        if (!isObject(scheme)) { return ''; }
        if (isNumericScheme(scheme)) { return 'Percentages as-is'; }

        var bands = Array.isArray(scheme.bands) ? scheme.bands : [];
        if (bands.length === 0) { return ''; }

        var parts = [];
        for (var i = 0; i < bands.length; i++) {
            var band = bands[i];
            if (!band || !band.label) { continue; }

            var upper = (i === 0) ? MAX_PERCENT : (bands[i - 1].minPercent - 1);
            var lower = band.minPercent;

            var rangeStr;
            if (lower === upper) {
                rangeStr = String(lower) + '%';
            } else {
                rangeStr = lower + '\u2013' + upper + '%';
            }

            parts.push(band.label + ': ' + rangeStr);
        }

        return parts.join(', ');
    }

    /**
     * Render a compact list of band labels, in descending minPercent
     * order, as a comma-joined string.
     */
    function getBandLabels(scheme) {
        if (!isObject(scheme) || !Array.isArray(scheme.bands)) {
            return '';
        }
        var parts = [];
        for (var i = 0; i < scheme.bands.length; i++) {
            var band = scheme.bands[i];
            if (band && band.label) {
                parts.push(band.label);
            }
        }
        return parts.join(', ');
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    // Presets are exposed as a clone. The originals are frozen inside
    // this module and never handed out.
    var PRESETS_PUBLIC = Object.freeze(getPresets().map(function(p) {
        return deepFreeze(p);
    }));

    window.AcademyGradeSchemes = Object.freeze({
        // Constants
        VALID_PRESET_IDS: VALID_PRESET_IDS,
        DEFAULT_PRESET_ID: DEFAULT_PRESET_ID,
        NUMERIC_SENTINEL_LABEL: NUMERIC_SENTINEL_LABEL,
        MIN_PERCENT: MIN_PERCENT,
        MAX_PERCENT: MAX_PERCENT,
        MAX_BANDS: MAX_BANDS,
        MAX_LABEL_LENGTH: MAX_LABEL_LENGTH,
        MAX_SCHEME_LABEL_LENGTH: MAX_SCHEME_LABEL_LENGTH,

        // Passing + letter-grade defaults
        PASSING_THRESHOLD: PASSING_THRESHOLD,
        FAIL_LABELS: FAIL_LABELS,
        LETTER_GRADES: LETTER_GRADES,

        // Presets (read-only)
        PRESETS: PRESETS_PUBLIC,

        getPresets: getPresets,
        getPreset: getPreset,
        isValidPresetId: isValidPresetId,
        getValidPresetIds: getValidPresetIds,
        getDefaultPresetId: getDefaultPresetId,
        getNumericSentinelLabel: getNumericSentinelLabel,

        // Default + numeric sentinel
        getDefaultScheme: getDefaultScheme,
        isNumericScheme: isNumericScheme,

        // Validation + normalisation
        validateScheme: validateScheme,
        isValidScheme: isValidScheme,
        normalizeScheme: normalizeScheme,

        // Conversion
        getBandForScore: getBandForScore,
        getLabelForScore: getLabelForScore,
        getGradeDisplay: getGradeDisplay,

        // Passing
        getLowestPassingBand: getLowestPassingBand,
        isPassing: isPassing,

        // Letter grade
        getLetterGrade: getLetterGrade,

        // Display helpers
        getRangeLabel: getRangeLabel,
        getBandLabels: getBandLabels
    });

    // ============================================================
    // VERIFICATION
    // ============================================================

    (function verify() {
        var exports = window.AcademyGradeSchemes;
        var missing = [];

        var required = [
            'getPresets', 'getPreset', 'isValidPresetId', 'getValidPresetIds',
            'getDefaultPresetId', 'getNumericSentinelLabel',
            'getDefaultScheme', 'isNumericScheme',
            'validateScheme', 'isValidScheme', 'normalizeScheme',
            'getBandForScore', 'getLabelForScore', 'getGradeDisplay',
            'getLowestPassingBand', 'isPassing', 'getLetterGrade',
            'getRangeLabel', 'getBandLabels'
        ];

        for (var i = 0; i < required.length; i++) {
            if (typeof exports[required[i]] !== 'function') {
                missing.push(required[i]);
            }
        }

        if (missing.length > 0) {
            console.warn('[AcademyGradeSchemes] Verification - missing exports:', missing.join(', '));
        }
    })();

})();
