/**
 * js/modules/missions/mission-views.js - Mission Views
 *
 * Path: js/modules/missions/mission-views.js
 *
 * Presentation metadata for missions.
 *
 * WHAT THIS MODULE OWNS:
 *   - CSS class names for statuses, priorities, mission types.
 *   - CSS colour tokens for statuses and priorities (used by
 *     anything that needs a raw colour rather than a class).
 *   - Icons for mission types.
 *   - Display formatting for timestamps and pay strings.
 *   - The { label, class } / { label, class, color } composite
 *     shapes that the aggregator attaches to VMs.
 *
 * WHAT THIS MODULE DOES NOT OWN:
 *   - Domain vocabulary. Every label comes from MissionConstants.
 *     This module never redefines "Medium" or "Tier III".
 *   - Querying or validating. It receives a value and returns
 *     presentation metadata for it.
 *   - Rendering HTML. MissionRender owns that.
 *   - Composition with mission records. MissionAggregator owns
 *     that. This module's functions take a single enum value and
 *     return one object or one string.
 *
 * FALLBACK POLICY:
 *   For unknown input, these functions return a well-marked
 *   "unknown" result, never a fabricated valid-looking value.
 *
 *   Specifically:
 *     getStatusInfo('banana')   -> { label: 'Unknown', class: 'status-unknown' }
 *     getStatusInfo('')         -> same
 *     getStatusInfo(null)       -> same
 *
 *   Not: { label: 'Active', class: 'status-active' }
 *
 *   The old behaviour of defaulting unknown values to a
 *   plausible-looking alternative has been removed. If a caller
 *   receives "Unknown", the mission data is malformed; that is
 *   information, and the renderer can display it as such.
 *
 * DEPENDENCIES (MANDATORY):
 *   - window.MissionConstants
 */

(function() {
    'use strict';

    if (window.__missionViewsLoaded) {
        return;
    }

    // ============================================================
    // MANDATORY DEPENDENCIES
    // ============================================================

    var MissionConstants = window.MissionConstants;

    var _missing = [];

    if (!MissionConstants) {
        _missing.push('MissionConstants (module)');
    } else {
        if (typeof MissionConstants.getStatusLabel !== 'function') {
            _missing.push('MissionConstants.getStatusLabel');
        }
        if (typeof MissionConstants.getPriorityLabel !== 'function') {
            _missing.push('MissionConstants.getPriorityLabel');
        }
        if (typeof MissionConstants.getDifficultyLabel !== 'function') {
            _missing.push('MissionConstants.getDifficultyLabel');
        }
        if (typeof MissionConstants.getBillingLabel !== 'function') {
            _missing.push('MissionConstants.getBillingLabel');
        }
        if (typeof MissionConstants.getEscalationLabel !== 'function') {
            _missing.push('MissionConstants.getEscalationLabel');
        }
        if (typeof MissionConstants.getMissionTypeLabel !== 'function') {
            _missing.push('MissionConstants.getMissionTypeLabel');
        }
        if (typeof MissionConstants.getSubtypeLabel !== 'function') {
            _missing.push('MissionConstants.getSubtypeLabel');
        }
    }

    if (_missing.length > 0) {
        throw new Error(
            '[MissionViews] Missing mandatory dependencies: ' +
            _missing.join(', ')
        );
    }

    window.__missionViewsLoaded = true;

    // ============================================================
    // CLASS AND COLOUR MAPS
    // ============================================================
    //
    // These are PRESENTATION-ONLY. They do not redefine the label
    // for each value; the label comes from MissionConstants.
    //
    // If a value has no entry here, the caller receives the
    // "unknown" variant, not a fabricated "default" variant that
    // looks correct.

    var STATUS_CLASSES = Object.freeze({
        'active':    'mission-status-active',
        'completed': 'mission-status-completed',
        'cancelled': 'mission-status-cancelled'
    });

    var STATUS_COLORS = Object.freeze({
        'active':    'var(--accent)',
        'completed': 'var(--info)',
        'cancelled': 'var(--danger)'
    });

    var PRIORITY_CLASSES = Object.freeze({
        'critical': 'mission-priority-critical',
        'high':     'mission-priority-high',
        'medium':   'mission-priority-medium',
        'low':      'mission-priority-low'
    });

    var PRIORITY_COLORS = Object.freeze({
        'critical': 'var(--danger)',
        'high':     'var(--warning)',
        'medium':   'var(--accent)',
        'low':      'var(--text-dim)'
    });

    var MISSION_TYPE_ICONS = Object.freeze({
        'combat':        '⚔',
        'recovery':      '🔍',
        'investigation': '🔎',
        'exploration':   '🧭',
        'infiltration':  '🥷',
        'containment':   '🔒',
        'acquisition':   '📦',
        'research':      '🔬',
        'diplomatic':    '🤝',
        'assassination': '🎯'
    });

    var MISSION_TYPE_COLORS = Object.freeze({
        'combat':        'var(--danger)',
        'recovery':      'var(--warning)',
        'investigation': 'var(--accent)',
        'exploration':   'var(--info)',
        'infiltration':  'var(--warning)',
        'containment':   'var(--warning)',
        'acquisition':   'var(--accent)',
        'research':      'var(--info)',
        'diplomatic':    'var(--accent)',
        'assassination': 'var(--danger)'
    });

    // ============================================================
    // SMALL HELPERS
    // ============================================================

    function isNonEmptyString(value) {
        return typeof value === 'string' && value.trim() !== '';
    }

    function isFiniteNumber(value) {
        return typeof value === 'number' && isFinite(value);
    }

    // ============================================================
    // STATUS
    // ============================================================

    /**
     * Composite status presentation.
     *
     * @param {string} status
     * @returns {object} { label, class, color, isKnown }
     */
    function getStatusInfo(status) {
        var label = MissionConstants.getStatusLabel(status);

        if (label === null) {
            return {
                label: 'Unknown',
                class: 'mission-status-unknown',
                color: 'var(--text-dim)',
                isKnown: false
            };
        }

        return {
            label: label,
            class: STATUS_CLASSES[status],
            color: STATUS_COLORS[status],
            isKnown: true
        };
    }

    function getStatusClass(status) {
        return STATUS_CLASSES[status] || 'mission-status-unknown';
    }

    function getStatusColor(status) {
        return STATUS_COLORS[status] || 'var(--text-dim)';
    }

    // ============================================================
    // PRIORITY
    // ============================================================

    /**
     * Composite priority presentation.
     *
     * @param {string} priority
     * @returns {object} { label, class, color, isKnown }
     */
    function getPriorityInfo(priority) {
        var label = MissionConstants.getPriorityLabel(priority);

        if (label === null) {
            return {
                label: 'Unknown',
                class: 'mission-priority-unknown',
                color: 'var(--text-dim)',
                isKnown: false
            };
        }

        return {
            label: label,
            class: PRIORITY_CLASSES[priority],
            color: PRIORITY_COLORS[priority],
            isKnown: true
        };
    }

    function getPriorityClass(priority) {
        return PRIORITY_CLASSES[priority] || 'mission-priority-unknown';
    }

    function getPriorityColor(priority) {
        return PRIORITY_COLORS[priority] || 'var(--text-dim)';
    }

    // ============================================================
    // MISSION TYPE
    // ============================================================

    /**
     * Composite mission type presentation.
     *
     * @param {string} typeId
     * @returns {object} { label, icon, color, isKnown }
     */
    function getMissionTypeInfo(typeId) {
        var label = MissionConstants.getMissionTypeLabel(typeId);

        if (label === null) {
            return {
                label: 'Unclassified',
                icon: '📋',
                color: 'var(--text-dim)',
                isKnown: false
            };
        }

        return {
            label: label,
            icon: MISSION_TYPE_ICONS[typeId] || '📋',
            color: MISSION_TYPE_COLORS[typeId] || 'var(--text-dim)',
            isKnown: true
        };
    }

    function getMissionTypeIcon(typeId) {
        return MISSION_TYPE_ICONS[typeId] || '📋';
    }

    function getMissionTypeColor(typeId) {
        return MISSION_TYPE_COLORS[typeId] || 'var(--text-dim)';
    }

    // ============================================================
    // VOCABULARY RE-EXPORTS
    // ============================================================
    //
    // Callers that reach for MissionViews expecting the vocabulary
    // lookups find them here. The canonical home is
    // MissionConstants; these are pass-throughs.
    //
    // These return null for unknown input, matching
    // MissionConstants.

    function getDifficultyLabel(difficulty) {
        return MissionConstants.getDifficultyLabel(difficulty);
    }

    function getDifficultyCode(difficulty) {
        return MissionConstants.getDifficultyCode(difficulty);
    }

    function getDifficultyFromCode(code) {
        return MissionConstants.getDifficultyFromCode(code);
    }

    function getBillingLabel(billing) {
        return MissionConstants.getBillingLabel(billing);
    }

    function getEscalationLabel(escalation) {
        return MissionConstants.getEscalationLabel(escalation);
    }

    function getMissionTypeLabel(typeId) {
        return MissionConstants.getMissionTypeLabel(typeId);
    }

    function getSubtypeLabel(typeId, subtypeId) {
        return MissionConstants.getSubtypeLabel(typeId, subtypeId);
    }

    // ============================================================
    // TIMESTAMP FORMATTING
    // ============================================================

    /**
     * Format an ISO timestamp for display.
     *
     * Returns '' for missing or malformed input. Never throws.
     *
     * Format: locale-dependent. Uses toLocaleString() with a fixed
     * options object so output is stable across renders on the same
     * machine. The choice of locale is the browser's.
     *
     * @param {string} iso
     * @returns {string}
     */
    function formatTimestamp(iso) {
        if (!isNonEmptyString(iso)) { return ''; }

        var date = new Date(iso);
        if (isNaN(date.getTime())) { return ''; }

        try {
            return date.toLocaleString(undefined, {
                year: 'numeric',
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            });
        } catch (e) {
            // Some environments may not support options; fall back.
            try {
                return date.toLocaleString();
            } catch (e2) {
                return '';
            }
        }
    }

    /**
     * Format just the date portion of an ISO timestamp.
     */
    function formatDate(iso) {
        if (!isNonEmptyString(iso)) { return ''; }

        var date = new Date(iso);
        if (isNaN(date.getTime())) { return ''; }

        try {
            return date.toLocaleDateString(undefined, {
                year: 'numeric',
                month: 'short',
                day: 'numeric'
            });
        } catch (e) {
            try {
                return date.toLocaleDateString();
            } catch (e2) {
                return '';
            }
        }
    }

    // ============================================================
    // PAY FORMATTING
    // ============================================================

    /**
     * Format a numeric pay value for display.
     *
     * The stored `mission.pay` field is already a formatted string
     * ("500.00 credits"). This helper handles the case where the
     * caller has a raw number and needs the same format.
     *
     * Returns '' for null, undefined, NaN, Infinity, or negative.
     * Returns the number formatted with two decimals plus the
     * "credits" suffix otherwise.
     *
     * @param {number|string} value
     * @returns {string}
     */
    function formatPay(value) {
        if (value === null || value === undefined || value === '') {
            return '';
        }

        var n;

        if (typeof value === 'number') {
            n = value;
        } else if (typeof value === 'string') {
            var trimmed = value.trim();
            if (trimmed === '') { return ''; }
            if (!/^\d+(?:\.\d+)?$/.test(trimmed)) {
                // Already formatted, or invalid. Return as-is if it
                // looks like a formatted string already.
                if (/^\d+(?:\.\d+)?\s+credits$/.test(trimmed)) {
                    return trimmed;
                }
                return '';
            }
            n = Number(trimmed);
        } else {
            return '';
        }

        if (!isFinite(n) || n < 0) {
            return '';
        }

        return n.toFixed(2) + ' credits';
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.MissionViews = Object.freeze({
        // Composite presentation
        getStatusInfo: getStatusInfo,
        getPriorityInfo: getPriorityInfo,
        getMissionTypeInfo: getMissionTypeInfo,

        // Individual class / colour / icon lookups
        getStatusClass: getStatusClass,
        getStatusColor: getStatusColor,
        getPriorityClass: getPriorityClass,
        getPriorityColor: getPriorityColor,
        getMissionTypeIcon: getMissionTypeIcon,
        getMissionTypeColor: getMissionTypeColor,

        // Vocabulary pass-throughs (canonical home: MissionConstants)
        getDifficultyLabel: getDifficultyLabel,
        getDifficultyCode: getDifficultyCode,
        getDifficultyFromCode: getDifficultyFromCode,
        getBillingLabel: getBillingLabel,
        getEscalationLabel: getEscalationLabel,
        getMissionTypeLabel: getMissionTypeLabel,
        getSubtypeLabel: getSubtypeLabel,

        // Formatting
        formatTimestamp: formatTimestamp,
        formatDate: formatDate,
        formatPay: formatPay,

        // Read-only constants (for consumers that want to iterate)
        STATUS_CLASSES: STATUS_CLASSES,
        STATUS_COLORS: STATUS_COLORS,
        PRIORITY_CLASSES: PRIORITY_CLASSES,
        PRIORITY_COLORS: PRIORITY_COLORS,
        MISSION_TYPE_ICONS: MISSION_TYPE_ICONS,
        MISSION_TYPE_COLORS: MISSION_TYPE_COLORS
    });

    // ============================================================
    // VERIFICATION
    // ============================================================

    (function verify() {
        var exports = window.MissionViews;
        var missing = [];

        var required = [
            'getStatusInfo',
            'getPriorityInfo',
            'getMissionTypeInfo',
            'getStatusClass',
            'getStatusColor',
            'getPriorityClass',
            'getPriorityColor',
            'getMissionTypeIcon',
            'getMissionTypeColor',
            'getDifficultyLabel',
            'getDifficultyCode',
            'getDifficultyFromCode',
            'getBillingLabel',
            'getEscalationLabel',
            'getMissionTypeLabel',
            'getSubtypeLabel',
            'formatTimestamp',
            'formatDate',
            'formatPay'
        ];

        for (var i = 0; i < required.length; i++) {
            if (typeof exports[required[i]] !== 'function') {
                missing.push(required[i]);
            }
        }

        // Smoke test: valid input returns valid presentation, and
        // unknown input returns the "unknown" variant, not a
        // plausible-looking default.
        try {
            var activeInfo = getStatusInfo('active');
            if (activeInfo.label !== 'Active' ||
                activeInfo.class !== 'mission-status-active' ||
                activeInfo.isKnown !== true) {
                missing.push('getStatusInfo("active") returned wrong shape');
            }

            var unknownStatus = getStatusInfo('banana');
            if (unknownStatus.label !== 'Unknown' ||
                unknownStatus.class !== 'mission-status-unknown' ||
                unknownStatus.isKnown !== false) {
                missing.push('getStatusInfo("banana") did not return the unknown variant');
            }

            var nullStatus = getStatusInfo(null);
            if (nullStatus.label !== 'Unknown' ||
                nullStatus.isKnown !== false) {
                missing.push('getStatusInfo(null) did not return the unknown variant');
            }

            var criticalInfo = getPriorityInfo('critical');
            if (criticalInfo.label !== 'Critical' ||
                criticalInfo.class !== 'mission-priority-critical' ||
                criticalInfo.isKnown !== true) {
                missing.push('getPriorityInfo("critical") returned wrong shape');
            }

            var unknownPriority = getPriorityInfo('banana');
            if (unknownPriority.label !== 'Unknown' ||
                unknownPriority.isKnown !== false) {
                missing.push('getPriorityInfo("banana") did not return the unknown variant');
            }

            var combatInfo = getMissionTypeInfo('combat');
            if (combatInfo.label !== 'Combat' ||
                combatInfo.isKnown !== true) {
                missing.push('getMissionTypeInfo("combat") returned wrong shape');
            }

            var unknownType = getMissionTypeInfo('banana');
            if (unknownType.label !== 'Unclassified' ||
                unknownType.isKnown !== false) {
                missing.push('getMissionTypeInfo("banana") did not return the unknown variant');
            }

            // Pay formatting
            if (formatPay(500) !== '500.00 credits') {
                missing.push("formatPay(500) !== '500.00 credits'");
            }
            if (formatPay(null) !== '') {
                missing.push("formatPay(null) !== ''");
            }
            if (formatPay('banana') !== '') {
                missing.push("formatPay('banana') !== ''");
            }
            if (formatPay('500.00 credits') !== '500.00 credits') {
                missing.push('formatPay did not pass through already-formatted string');
            }

            // Timestamp formatting
            if (formatTimestamp(null) !== '') {
                missing.push("formatTimestamp(null) !== ''");
            }
            if (formatTimestamp('not-a-date') !== '') {
                missing.push("formatTimestamp('not-a-date') !== ''");
            }
            var ts = formatTimestamp('2026-09-17T12:00:00.000Z');
            if (typeof ts !== 'string' || ts === '') {
                missing.push('formatTimestamp of a valid ISO string returned empty');
            }
        } catch (e) {
            missing.push('smoke test threw: ' + e.message);
        }

        if (missing.length > 0) {
            console.warn(
                '[MissionViews] Verification failed:',
                missing.join(', ')
            );
        }
    })();

})();
