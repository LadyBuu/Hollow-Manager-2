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
 *   - Providing passing semantics (explicit `passing` field or label heuristic)
 *   - Providing letter-grade semantics (default letter map or scheme-aware)
 *
 * IMPORTANT:
 *   - PURE. No DOM, no persistence, no queries. Constants + functions only.
 *   - Schemes are FULLY user-editable. Presets only seed the bands array;
 *     after that, the stored scheme is the source of truth.
 *   - Grades are ALWAYS stored as percentages. The scheme is a display layer.
 *     Nothing about the converted label is persisted.
 *
 * SCHEME SHAPE:
 *   {
 *     id:        string,   // preset marker: 'letter' | 'pass_fail' | 'numeric' | 'custom'
 *     label:     string,   // display name, user-editable
 *     bands: [
 *       {
 *         label:      string,
 *         minPercent: integer 0..100,
 *         passing:    boolean   // OPTIONAL; see PASSING SEMANTICS below
 *       },
 *       ...
 *     ]
 *   }
 *
 * BAND SEMANTICS:
 *   - Canonical (normalised) bands are sorted DESCENDING by minPercent.
 *   - The band whose minPercent is the largest value <= score wins.
 *   - The lowest band MUST have minPercent === 0 so every score matches.
 *   - Bands must have unique labels (case-sensitive).
 *
 * VALIDATION vs NORMALISATION:
 *   Two distinct contracts, deliberately separated:
 *
 *     validateScheme(scheme)
 *       Reports whether a scheme is VALID. Checks semantic validity
 *       independent of ordering: bands form a non-empty array, each
 *       band has a non-empty label and an integer minPercent in
 *       range, labels are unique, minPercents are unique, exactly
 *       one band has minPercent === 0.
 *
 *       Does NOT require descending order. Ordering is a
 *       canonical-form concern, not a semantic one; normalisation
 *       guarantees it.
 *
 *     normalizeScheme(raw)
 *       Produces a canonical scheme from arbitrary input.
 *
 *       NORMALISATION POLICY:
 *         - A structurally valid scheme is returned as a canonical
 *           clone, bands sorted descending.
 *         - Formatting differences that parse unambiguously are
 *           coerced: minPercent: "80" becomes 80. minPercent:
 *           "80garbage" is REJECTED (see below).
 *         - A structurally INVALID scheme falls back to the numeric
 *           default wholesale. It is NOT repaired.
 *
 *       WHY FALLBACK, NOT REPAIR:
 *         Silently inventing a missing band or dropping a malformed
 *         one changes what a student's grade MEANS. If a scheme
 *         has bands A/90, B/80, C/70 and C is malformed, dropping
 *         it would turn 75% into an F instead of a C. That is not
 *         cosmetic corruption. It is a changed academic result.
 *
 *         A malformed scheme falls back to the numeric default so
 *         the caller sees a coherent (if unhelpful) scheme instead
 *         of a subtly wrong one. The caller can detect the
 *         fallback and surface it; silent repair would hide it.
 *
 * PASSING SEMANTICS:
 *   A band may carry an explicit `passing: boolean` field. When ANY
 *   band in the scheme carries an explicit `passing` field, that
 *   field is authoritative for that band. The scheme's
 *   "lowest passing band" is the band with the smallest minPercent
 *   whose `passing` is not explicitly false.
 *
 *   When NO band carries an explicit `passing` field, the module
 *   falls back to a label heuristic: labels in FAIL_LABELS ('F',
 *   'Fail') are considered failing, and the lowest passing band is
 *   the one with the smallest minPercent that is not fail-labelled.
 *
 *   The heuristic exists for schemes written before explicit
 *   `passing` support. It is a compatibility path, not a design
 *   recommendation. New schemes SHOULD carry explicit `passing`
 *   fields, because a custom scheme with labels like
 *   "Unsatisfactory" has no recognised fail label and would
 *   otherwise treat every band as passing.
 *
 * isPassing(score, scheme):
 *   - If scheme is provided and is not the numeric scheme, uses the
 *     scheme's lowest passing band threshold (explicit or heuristic).
 *   - If scheme is not provided, or is the numeric scheme, uses
 *     PASSING_THRESHOLD (70).
 *
 * NUMERIC SENTINEL:
 *   The numeric scheme means "no conversion": display the raw
 *   percentage. It is identified by having exactly one band whose
 *   label is the sentinel '%', OR by having id === 'numeric' AND
 *   a bands array whose shape matches the numeric preset.
 *
 *   The preset ID is HISTORICAL METADATA. The bands are the source
 *   of truth for semantics. A scheme with id === 'numeric' but with
 *   letter-grade bands is NOT treated as numeric; it behaves like
 *   the letter-grade scheme it actually is.
 *
 * LETTER GRADE SEMANTICS:
 *   getGradeBand(score, scheme)
 *     Returns the matching band's label (as both label and
 *     description). For the numeric scheme, returns null.
 *
 *   getLetterGrade(score, scheme)
 *     DEPRECATED NAME. Alias of getGradeBand with a fallback to the
 *     default LETTER_GRADES map (A/B/C/D/F at 90/80/70/60/0) when
 *     scheme is absent. Retained for backward compatibility.
 *
 *   New code should call getGradeBand.
 *
 * DEPENDENCIES:
 *   None (self-contained)
 *
 * USAGE:
 *   var S = window.AcademyGradeSchemes;
 *   var preset = S.getPreset('letter');
 *   var scheme = S.normalizeScheme(rawScheme);
 *   var band = S.getGradeBand(87, scheme);            // → { label: 'B', description: 'B' }
 *   var preview = S.getRangeLabel(scheme);            // → 'A: 90–100%, B: 80–89%, ...'
 *   var passed = S.isPassing(87, scheme);             // → true
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

    var VALID_PRESET_IDS = Object.freeze([
        'letter',
        'pass_fail',
        'numeric',
        'custom'
    ]);

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
    // locate the "lowest passing band" in a custom scheme that does
    // NOT carry explicit `passing` fields. Case-sensitive matching
    // against the scheme's band labels.
    //
    // This is a COMPATIBILITY PATH for schemes written before
    // explicit `passing` support. New schemes should carry
    // explicit `passing` fields.
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
    //
    // The pass_fail preset carries explicit `passing` fields. The
    // letter preset does NOT; it relies on the FAIL_LABELS
    // heuristic ('F' is the failing label). This is deliberate:
    // the letter preset's labels are the canonical A/B/C/D/F set,
    // and the heuristic recognises 'F' correctly.

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
                { label: 'Pass', minPercent: 70, passing: true },
                { label: 'Fail', minPercent: 0,  passing: false }
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

    /**
     * Dedicated scheme clone.
     *
     * A generic JSON-based clone (or a `structuredClone` with a
     * silent fallback) is unsafe here: the fallback returns the
     * original object by reference, which lets a caller mutate the
     * canonical preset. Schemes have a small, well-defined shape;
     * a purpose-built clone is both safer and clearer.
     *
     * Preserves the `passing` field when present, so explicit
     * passing metadata survives the clone.
     */
    function cloneScheme(scheme) {
        if (!isObject(scheme)) {
            return null;
        }

        var bands = [];
        if (Array.isArray(scheme.bands)) {
            for (var i = 0; i < scheme.bands.length; i++) {
                var band = scheme.bands[i];
                if (!isObject(band)) { continue; }
                var clonedBand = {
                    label: band.label,
                    minPercent: band.minPercent
                };
                if (typeof band.passing === 'boolean') {
                    clonedBand.passing = band.passing;
                }
                bands.push(clonedBand);
            }
        }

        var result = {
            id: scheme.id,
            label: scheme.label,
            bands: bands
        };

        return result;
    }

    /**
     * Strict integer parse for a percentage-like value.
     *
     * Accepts:
     *   - an integer number
     *   - a pure-digit string ("80", "-1")
     *
     * Rejects:
     *   - "80garbage", "80.5" (fractional), "" (empty)
     *   - NaN, Infinity, non-integer numbers
     *
     * Returns the integer, or null.
     */
    function parseStrictInteger(value) {
        if (value === undefined || value === null) {
            return null;
        }

        if (typeof value === 'number') {
            return Number.isInteger(value) ? value : null;
        }

        if (typeof value === 'string') {
            var trimmed = value.trim();
            if (trimmed === '') { return null; }
            if (!/^-?\d+$/.test(trimmed)) { return null; }
            var n = Number(trimmed);
            return Number.isInteger(n) ? n : null;
        }

        return null;
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
        return cloneScheme(numeric);
    }

    /**
     * Is this scheme the numeric sentinel?
     *
     * TRUE when:
     *   - the scheme has exactly one band whose label is the numeric
     *     sentinel ('%'), OR
     *   - the scheme's id is 'numeric' AND its bands match the
     *     numeric preset's shape (single band at minPercent 0).
     *
     * The bands are the source of truth. A scheme tagged
     * id === 'numeric' whose bands are letter-grade shaped is NOT
     * numeric; the id is historical metadata, not semantics.
     */
    function isNumericScheme(scheme) {
        if (!scheme || typeof scheme !== 'object') { return false; }

        // Primary test: sentinel band shape.
        if (Array.isArray(scheme.bands) && scheme.bands.length === 1) {
            var band = scheme.bands[0];
            if (band && band.label === NUMERIC_SENTINEL_LABEL) {
                return true;
            }
        }

        // Secondary test: id === 'numeric' AND bands match the
        // numeric preset's shape. The band check ensures we do not
        // treat a re-banded scheme as numeric.
        if (scheme.id === 'numeric') {
            if (!Array.isArray(scheme.bands)) { return true; }
            if (scheme.bands.length !== 1) { return false; }
            var only = scheme.bands[0];
            if (!only || typeof only !== 'object') { return false; }
            if (only.label !== NUMERIC_SENTINEL_LABEL) { return false; }
            if (only.minPercent !== 0) { return false; }
            return true;
        }

        return false;
    }

    // ============================================================
    // PRESETS - lookup
    // ============================================================

    function getPresets() {
        var result = [];
        for (var i = 0; i < PRESETS.length; i++) {
            result.push(cloneScheme(PRESETS[i]));
        }
        return result;
    }

    function getPreset(id) {
        if (!isNonEmptyString(id)) { return null; }
        for (var i = 0; i < PRESETS.length; i++) {
            if (PRESETS[i].id === id) {
                return cloneScheme(PRESETS[i]);
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
     * SEMANTIC validity, independent of band ordering. Normalisation
     * is responsible for sorting; validation checks the shape.
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
     *   - band.passing, when present, is a boolean
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

            // Strict integer parse. "80garbage" is rejected.
            var minP = parseStrictInteger(band.minPercent);
            if (minP === null || minP < MIN_PERCENT || minP > MAX_PERCENT) {
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

            // passing, when present, must be a boolean.
            if (band.passing !== undefined &&
                typeof band.passing !== 'boolean') {
                errors.push({
                    field: 'band_' + i,
                    message: 'Band ' + idx + ' passing must be a boolean when present.'
                });
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
    // NORMALISATION POLICY:
    //   - Structurally valid input → canonical clone, sorted
    //     descending.
    //   - Structurally INVALID input → fall back to the numeric
    //     default wholesale.
    //
    // The policy is fallback, not repair. See the file header.
    //
    // "Structurally valid" here includes the strict integer parse
    // of minPercent. "80" (pure digit string) is coerced. "80abc"
    // fails validation and the whole scheme falls back to default.
    //
    // The canonical output:
    //   - id is a valid preset id or 'custom'
    //   - label is a non-empty string
    //   - bands is a non-empty array, sorted descending by minPercent
    //   - each band has a non-empty string label, integer minPercent
    //   - band labels are unique
    //   - exactly one band has minPercent === 0
    //   - band.passing is preserved when present and boolean
    //   - returned object is frozen

    function normalizeScheme(raw) {
        if (!isObject(raw)) {
            return deepFreeze(getDefaultScheme());
        }

        // Formatting-only coercion first: trim label, coerce
        // pure-digit minPercent strings to integers. This produces a
        // candidate that validateScheme can judge on semantic
        // grounds.
        var candidate = {
            id: isValidPresetId(raw.id) ? raw.id : 'custom',
            label: isNonEmptyString(raw.label)
                ? String(raw.label).trim().slice(0, MAX_SCHEME_LABEL_LENGTH)
                : 'Custom Scheme',
            bands: []
        };

        if (Array.isArray(raw.bands)) {
            for (var i = 0; i < raw.bands.length && i < MAX_BANDS; i++) {
                var band = raw.bands[i];
                if (!isObject(band)) { continue; }
                if (!isNonEmptyString(band.label)) { continue; }

                var bandLabel = String(band.label).trim().slice(0, MAX_LABEL_LENGTH);
                if (!bandLabel) { continue; }

                var minP = parseStrictInteger(band.minPercent);
                if (minP === null) { continue; }

                var coercedBand = {
                    label: bandLabel,
                    minPercent: minP
                };
                if (typeof band.passing === 'boolean') {
                    coercedBand.passing = band.passing;
                }
                candidate.bands.push(coercedBand);
            }
        }

        // Now validate the coerced candidate semantically.
        var check = validateScheme(candidate);
        if (!check.valid) {
            // Fall back to the numeric default wholesale. Do not
            // repair; a repaired scheme silently changes what a
            // student's grade means.
            return deepFreeze(getDefaultScheme());
        }

        // Sort descending. This is normalisation's job, not
        // validation's.
        candidate.bands.sort(function(a, b) {
            return b.minPercent - a.minPercent;
        });

        return deepFreeze(candidate);
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
     * Does the scheme carry ANY explicit `passing` field on its
     * bands?
     *
     * When true, the explicit fields are authoritative for the
     * bands that carry them; the label heuristic is not consulted.
     *
     * When false, the label heuristic applies to the whole scheme.
     */
    function schemeHasExplicitPassing(scheme) {
        if (!isObject(scheme) || !Array.isArray(scheme.bands)) {
            return false;
        }
        for (var i = 0; i < scheme.bands.length; i++) {
            var band = scheme.bands[i];
            if (band && typeof band === 'object' &&
                typeof band.passing === 'boolean') {
                return true;
            }
        }
        return false;
    }

    /**
     * Get the lowest passing band's minPercent for a scheme.
     *
     * A "passing band" is:
     *   - when the band carries an explicit `passing: true`, it is
     *     passing;
     *   - when the band carries an explicit `passing: false`, it is
     *     failing;
     *   - when the band carries no explicit `passing`, it is
     *     passing iff its label is not in FAIL_LABELS.
     *
     * Returns null when:
     *   - scheme is missing or numeric
     *   - no band is considered passing
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

            var isPassingBand;
            if (typeof band.passing === 'boolean') {
                isPassingBand = band.passing === true;
            } else {
                isPassingBand = FAIL_LABELS.indexOf(band.label) === -1;
            }

            if (!isPassingBand) { continue; }

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
     *       * Compute the lowest passing band's threshold (explicit
     *         or heuristic).
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
            // No passing band in the scheme. Nothing passes.
            return false;
        }

        return pct >= PASSING_THRESHOLD;
    }

    // ============================================================
    // GRADE-BAND SEMANTICS
    // ============================================================

    /**
     * Get the grade band for a score under a scheme.
     *
     * SEMANTICS:
     *   - If scheme is provided and is NOT numeric:
     *       * Returns the matching band's label as both label and
     *         description.
     *   - If scheme is numeric or missing:
     *       * Returns null. Callers that want a fallback letter
     *         grade call getLetterGrade.
     *
     * Return shape:
     *   { label: string, description: string } | null
     *
     * @param {number} score - Percentage (0-100)
     * @param {object|null} scheme - Optional scheme
     * @returns {object|null}
     */
    function getGradeBand(score, scheme) {
        var pct = Number(score);
        if (!isFinite(pct)) {
            return null;
        }
        if (pct < MIN_PERCENT) { pct = MIN_PERCENT; }
        if (pct > MAX_PERCENT) { pct = MAX_PERCENT; }

        if (isObject(scheme) && !isNumericScheme(scheme)) {
            var band = getBandForScore(scheme, pct);
            if (band && isNonEmptyString(band.label)) {
                return {
                    label: band.label,
                    description: band.label
                };
            }
        }

        return null;
    }

    /**
     * DEPRECATED NAME. Alias of getGradeBand with a fallback to the
     * default LETTER_GRADES map (A/B/C/D/F at 90/80/70/60/0) when
     * the scheme returns no band.
     *
     * New code should call getGradeBand.
     *
     * @param {number} score - Percentage (0-100)
     * @param {object|null} scheme - Optional scheme
     * @returns {object} { label, description }
     */
    function getLetterGrade(score, scheme) {
        var band = getGradeBand(score, scheme);
        if (band) { return band; }

        var pct = Number(score);
        if (!isFinite(pct)) {
            return { label: '?', description: 'Invalid' };
        }
        if (pct < MIN_PERCENT) { pct = MIN_PERCENT; }
        if (pct > MAX_PERCENT) { pct = MAX_PERCENT; }

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
     *
     * Assumes canonical descending bands (as produced by
     * normalizeScheme). If bands are not sorted, the preview shows
     * the ranges as the bands specify them, which may be wrong; the
     * caller is responsible for normalising before previewing.
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

    // Presets are exposed as a deep-frozen clone. The originals are
    // frozen inside this module and never handed out.
    var PRESETS_PUBLIC = deepFreeze(getPresets());

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
        schemeHasExplicitPassing: schemeHasExplicitPassing,

        // Grade band (canonical) and letter grade (deprecated alias)
        getGradeBand: getGradeBand,
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
            'getLowestPassingBand', 'isPassing', 'schemeHasExplicitPassing',
            'getGradeBand', 'getLetterGrade',
            'getRangeLabel', 'getBandLabels'
        ];

        for (var i = 0; i < required.length; i++) {
            if (typeof exports[required[i]] !== 'function') {
                missing.push(required[i]);
            }
        }

        try {
            // Malformed minPercent must fall back to the numeric
            // default, not repair into a plausible scheme.
            var malformed = exports.normalizeScheme({
                label: 'My Scheme',
                bands: [
                    { label: 'Pass', minPercent: 70 },
                    { label: 'Fail', minPercent: '80garbage' }
                ]
            });
            if (malformed.label !== 'Numeric') {
                missing.push(
                    'normalizeScheme did not fall back on malformed ' +
                    'minPercent'
                );
            }

            // Strict integer parsing.
            if (exports.validateScheme({
                label: 'X',
                bands: [
                    { label: 'A', minPercent: '80garbage' },
                    { label: 'F', minPercent: 0 }
                ]
            }).valid !== false) {
                missing.push(
                    'validateScheme accepted a trailing-garbage minPercent'
                );
            }

            // Explicit passing field honoured.
            var explicit = exports.normalizeScheme({
                id: 'custom',
                label: 'Explicit',
                bands: [
                    { label: 'Unsatisfactory', minPercent: 0, passing: false },
                    { label: 'Satisfactory', minPercent: 70, passing: true }
                ]
            });
            if (exports.isPassing(50, explicit) !== false) {
                missing.push(
                    'isPassing ignored explicit passing: false'
                );
            }
            if (exports.isPassing(80, explicit) !== true) {
                missing.push(
                    'isPassing ignored explicit passing: true'
                );
            }

            // Bands are authoritative for numeric detection.
            var rebanded = {
                id: 'numeric',
                label: 'Rebanded',
                bands: [
                    { label: 'A', minPercent: 90 },
                    { label: 'F', minPercent: 0 }
                ]
            };
            if (exports.isNumericScheme(rebanded) !== false) {
                missing.push(
                    'isNumericScheme treated a re-banded numeric scheme as numeric'
                );
            }
        } catch (e) {
            missing.push('smoke test threw: ' + e.message);
        }

        if (missing.length > 0) {
            console.warn('[AcademyGradeSchemes] Verification failed:', missing.join(', '));
        }
    })();

})();
