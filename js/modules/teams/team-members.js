/**
 * js/modules/teams/team-members.js - Team Member Management
 * Handles member status, eligibility, and rendering
 * Path: js/modules/teams/team-members.js
 * 
 * This module is responsible for:
 *   - Determining member status at a given period (historical timeline engine)
 *   - Determining character eligibility for teams
 *   - Rendering member lists (returns HTML)
 *   - Providing eligibility status for UI display
 * 
 * IMPORTANT: This module is READ-ONLY for data operations.
 * All mutations are delegated to TeamCore.
 * This module does NOT call saveData().
 * 
 * ELIGIBILITY CONCEPTS:
 *   - Candidate characters: Those whose career status at a SPECIFIC PERIOD
 *     makes them appropriate for a team type. This is PERIOD-AWARE.
 *   - Eligibility status: Whether a candidate can be added to a specific team
 *     at a specific period, with appropriate UI labels and styling
 * 
 * HISTORICAL TIMELINE ENGINE:
 *   - getStatusAtPeriod() is timeline-aware: it answers "what was this
 *     member's status at this point in time?"
 *   - Deceased status is only returned if death occurred at or before the period
 *   - Unknown death dates do NOT override known membership history
 *   - If a death date is unknown, membership history takes precedence
 *   - PERIOD UNITS ARE TYPE-AWARE: academic teams use weeks, others use years
 * 
 * PERIOD SEMANTICS:
 *   - leavePeriod is INCLUSIVE: member remains active during leavePeriod
 *   - joinPeriod is INCLUSIVE: member becomes active at joinPeriod
 *   - Membership is active when: join <= period <= leave
 *   - This convention is consistent with team startPeriod/endPeriod
 * 
 * PERSISTENCE CONTRACT:
 *   - This module does NOT persist data
 *   - Callers are responsible for saveData() after mutations
 *   - TeamCore owns all member mutations
 * 
 * SECURITY:
 *   - All user-controlled data is escaped before HTML insertion
 *   - Role names are escaped
 *   - Character names are escaped
 * 
 * DEPENDENCIES:
 *   - window.TeamCore - Core team operations (required)
 *   - window.CALENDAR_CONSTANTS - Week/year constants (from constants.js)
 *   - window.STATUS_CONSTANTS - Status constants (from constants.js)
 *   - window.DomUtils - HTML escaping (from dom-utils.js)
 *   - window.getCharacterById (from core-utils.js)
 *   - window.getDisplayName (from core-utils.js)
 *   - window.getCurrentStatus (from core-utils.js)
 *   - window.getCharacterAge (from core-utils.js) - NOTE: Currently uses current age, not period-aware
 */

(function() {
    'use strict';

    // Guard against duplicate script loading
    // IMPORTANT: Check dependency BEFORE marking as loaded
    if (window.__teamMembersLoaded) {
        return;
    }

    if (!window.TeamCore) {
        console.error('TeamMembers: TeamCore is required but not loaded.');
        return;
    }

    window.__teamMembersLoaded = true;

    // ============================================================
    // CONSTANTS
    // ============================================================

    var CALENDAR = window.CALENDAR_CONSTANTS || {};
    var STATUS = window.STATUS_CONSTANTS || {};

    var MIN_WEEK = CALENDAR.MIN_WEEK || 1;
    var MAX_WEEK = CALENDAR.MAX_WEEK || 52;
    var MIN_YEAR = CALENDAR.MIN_YEAR || 1900;
    var MAX_YEAR = CALENDAR.MAX_YEAR || 2100;

    var ALLOWED_NON_CIVILIAN = ['trainee', 'rookie', 'junior', 'senior', 'instructor', 'support'];

    // ============================================================
    // HTML ESCAPING - Use DomUtils when available
    // ============================================================

    function escapeHtml(value) {
        if (window.DomUtils && typeof window.DomUtils.escapeHtml === 'function') {
            return window.DomUtils.escapeHtml(value);
        }
        // Fallback
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    // ============================================================
    // PERIOD PARSING - Shared with TeamCore
    // ============================================================

    function parseNumericPeriod(value) {
        if (value === undefined || value === null || value === '') {
            return null;
        }
        var str = String(value).trim();
        if (!/^\d+$/.test(str)) {
            return null;
        }
        var parsed = Number(str);
        return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
    }

    function parsePositivePeriod(value) {
        var parsed = parseNumericPeriod(value);
        return (parsed !== null && parsed >= 1) ? parsed : null;
    }

    function isValidAcademicWeek(value) {
        var num = parseNumericPeriod(value);
        return num !== null && num >= MIN_WEEK && num <= MAX_WEEK;
    }

    function isValidYear(value) {
        var num = parseNumericPeriod(value);
        return num !== null && num >= MIN_YEAR && num <= MAX_YEAR;
    }

    /**
     * Parse a period with type awareness.
     * Returns { value: number, unit: 'week' | 'year' } or null.
     */
    function parseTypedPeriod(value, teamType) {
        var num = parseNumericPeriod(value);
        if (num === null) return null;

        if (teamType === 'academic') {
            if (num >= MIN_WEEK && num <= MAX_WEEK) {
                return { value: num, unit: 'week' };
            }
            return null;
        } else {
            if (num >= MIN_YEAR && num <= MAX_YEAR) {
                return { value: num, unit: 'year' };
            }
            return null;
        }
    }

    // ============================================================
    // PERIOD COMPARISON - Type-aware
    // ============================================================

    /**
     * Compare two periods of potentially different types.
     * Returns true if periodA <= periodB.
     * 
     * IMPORTANT: This only supports same-unit comparison.
     * Week vs year comparison is NOT supported (returns false).
     */
    function isPeriodLessThanOrEqual(periodA, periodB, unitA, unitB) {
        // Different units cannot be compared directly
        if (unitA !== unitB) {
            return false;
        }
        return periodA <= periodB;
    }

    // ============================================================
    // MEMBER STATUS DETERMINATION - Historical timeline engine
    // ============================================================

    /**
     * Get member status at a specific period.
     * Returns status strings: 'active', 'left', 'future', 'deceased', 'eliminated', 'unknown'
     * 
     * This is a TIMELINE-AWARE engine:
     * - Periods are type-aware: academic = weeks, others = years
     * - Death dates are compared only against year-based periods
     * - Eliminations are compared only against week-based periods (academic)
     * - Unknown death dates do NOT override known membership history
     * 
     * @param {object} member - Member object (must have characterId, joinPeriod, leavePeriod)
     * @param {number|string} period - Period (week or year)
     * @param {string} teamType - Team type ('academic', 'professional', 'temporary', 'civilian')
     * @returns {string} Status string
     */
    function getStatusAtPeriod(member, period, teamType) {
        if (!member || typeof member !== 'object') return 'unknown';

        // Parse period with type awareness
        var typedPeriod = parseTypedPeriod(period, teamType);
        if (!typedPeriod) {
            return 'unknown';
        }

        var periodNum = typedPeriod.value;
        var periodUnit = typedPeriod.unit;

        var char = window.getCharacterById ? window.getCharacterById(member.characterId) : null;

        // ============================================================
        // DECEASED CHECK - Only for year-based periods
        // ============================================================
        if (char && char.deceased && periodUnit === 'year') {
            var deathYear = parsePositivePeriod(char.deathYear);
            if (deathYear !== null) {
                // Death year is a year, compare against year-based period
                if (deathYear <= periodNum) {
                    return 'deceased';
                }
                // Death occurs in the future relative to this period
                // Continue to membership check
            } else {
                // Death date is unknown. Do not assume the character was dead
                // at this historical period. Continue to membership history.
            }
        }

        // ============================================================
        // ELIMINATION CHECK - Only for week-based periods (academic)
        // ============================================================
        if (periodUnit === 'week' && char && char.eliminatedWeeks && Array.isArray(char.eliminatedWeeks)) {
            for (var i = 0; i < char.eliminatedWeeks.length; i++) {
                var elimWeek = parsePositivePeriod(char.eliminatedWeeks[i]);
                if (elimWeek !== null && elimWeek <= periodNum) {
                    return 'eliminated';
                }
            }
        }

        // ============================================================
        // MEMBERSHIP CHECK - Period type aware
        // ============================================================
        var join = parsePositivePeriod(member.joinPeriod);
        var leave = parsePositivePeriod(member.leavePeriod);

        // If no join period, treat as unknown
        if (join === null) {
            return 'unknown';
        }

        // Parse join/leave with type awareness
        var typedJoin = parseTypedPeriod(member.joinPeriod, teamType);
        var typedLeave = member.leavePeriod ? parseTypedPeriod(member.leavePeriod, teamType) : null;

        // If join period doesn't match the team's period type, treat as unknown
        if (!typedJoin || typedJoin.unit !== periodUnit) {
            return 'unknown';
        }

        // Future member: join is in the future
        if (typedJoin.value > periodNum) {
            return 'future';
        }

        // Active member: join <= period and (no leave or leave >= period)
        if (typedLeave === null) {
            return 'active';
        }

        // If leave exists but doesn't match unit type, treat as open-ended
        if (typedLeave.unit !== periodUnit) {
            return 'active';
        }

        // leavePeriod is INCLUSIVE: member remains active during leavePeriod
        if (typedLeave.value >= periodNum) {
            return 'active';
        }

        // Otherwise, they've left
        return 'left';
    }

    /**
     * Get member status at a specific week (academic teams).
     * Convenience wrapper for getStatusAtPeriod.
     * 
     * @param {object} member - Member object
     * @param {number|string} week - Week number
     * @returns {string} Status string
     */
    function getStatusAtWeek(member, week) {
        return getStatusAtPeriod(member, week, 'academic');
    }

    // ============================================================
    // ELIGIBILITY STATUS - For UI display
    // ============================================================

    /**
     * Get eligibility status for a character in a team at a specific period.
     * Returns { label, disabled, style } for UI rendering.
     * This is the SINGLE AUTHORITY for eligibility classification.
     * 
     * Uses getStatusAtPeriod() as the underlying temporal authority.
     * 
     * @param {object} team - Team object
     * @param {object} char - Character object
     * @param {number|string} currentPeriod - Current period
     * @returns {object} { label, disabled, style }
     */
    function getEligibilityStatus(team, char, currentPeriod) {
        if (!team || !char) {
            return {
                label: 'Unavailable',
                disabled: true,
                style: 'color:var(--text-dim);'
            };
        }

        var charId = char.id;

        // Parse period with type awareness
        var typedPeriod = parseTypedPeriod(currentPeriod, team.type);
        if (!typedPeriod) {
            return {
                label: 'Invalid period',
                disabled: true,
                style: 'color:var(--text-dim);'
            };
        }

        var periodNum = typedPeriod.value;
        var periodUnit = typedPeriod.unit;

        // Find the actual member record if the character is in this team
        var existingMember = null;
        if (team.members && Array.isArray(team.members)) {
            existingMember = team.members.find(function(member) {
                return member && String(member.characterId) === String(charId);
            });
        }

        // If character is in this team, check their status using the canonical timeline engine
        if (existingMember) {
            var memberStatus = getStatusAtPeriod(
                existingMember,
                currentPeriod,
                team.type
            );

            if (memberStatus === 'active') {
                return {
                    label: '✓ In Team',
                    disabled: true,
                    style: 'color:var(--accent);font-weight:bold;'
                };
            }

            if (memberStatus === 'future') {
                return {
                    label: '⏳ Future Member',
                    disabled: true,
                    style: 'color:var(--warning);'
                };
            }

            if (memberStatus === 'deceased') {
                return {
                    label: '✝ Deceased (Former)',
                    disabled: true,
                    style: 'color:var(--danger);text-decoration:line-through;'
                };
            }

            if (memberStatus === 'eliminated') {
                return {
                    label: '⚠ Eliminated (Former)',
                    disabled: true,
                    style: 'color:var(--danger);'
                };
            }

            if (memberStatus === 'unknown') {
                return {
                    label: '? Unknown Status',
                    disabled: true,
                    style: 'color:var(--text-dim);font-style:italic;'
                };
            }

            return {
                label: '↩ Former Member',
                disabled: true,
                style: 'color:var(--text-dim);font-style:italic;'
            };
        }

        // Character is not in this team - check if they can be added

        // Character deceased (timeline-aware, only for year-based periods)
        if (char.deceased && periodUnit === 'year') {
            var deathYear = parsePositivePeriod(char.deathYear);
            if (deathYear !== null) {
                if (deathYear <= periodNum) {
                    return {
                        label: '✝ Deceased',
                        disabled: true,
                        style: 'color:var(--danger);text-decoration:line-through;'
                    };
                }
                // If death is in the future, treat as available
            } else {
                // Death date unknown - treat as available (don't block)
                // The user can decide if this is appropriate
            }
        }

        // Character eliminated (timeline-aware, only for week-based periods)
        if (periodUnit === 'week' && char.eliminatedWeeks && Array.isArray(char.eliminatedWeeks)) {
            for (var i = 0; i < char.eliminatedWeeks.length; i++) {
                var elimWeek = parsePositivePeriod(char.eliminatedWeeks[i]);
                if (elimWeek !== null && elimWeek <= periodNum) {
                    return {
                        label: '⚠ Eliminated',
                        disabled: true,
                        style: 'color:var(--danger);'
                    };
                }
            }
        }

        // Check if character is active/future in another team
        // (Uses TeamCore.getAllTeams() when available)
        var teams = [];
        if (window.TeamCore && typeof window.TeamCore.getAllTeams === 'function') {
            teams = window.TeamCore.getAllTeams();
        } else {
            var data = window.data || {};
            teams = data.teams || [];
        }

        if (Array.isArray(teams)) {
            for (var i = 0; i < teams.length; i++) {
                var otherTeam = teams[i];
                if (!otherTeam || typeof otherTeam !== 'object') continue;
                if (String(otherTeam.id) === String(team.id)) continue;
                if (otherTeam.status === 'deleted') continue;
                if (!Array.isArray(otherTeam.members)) continue;

                var otherMember = otherTeam.members.find(function(member) {
                    return member && String(member.characterId) === String(charId);
                });

                if (otherMember) {
                    var otherStatus = getStatusAtPeriod(
                        otherMember,
                        currentPeriod,
                        otherTeam.type
                    );
                    if (otherStatus === 'active' || otherStatus === 'future') {
                        return {
                            label: '⊗ In Other Team',
                            disabled: true,
                            style: 'color:var(--text-dim);'
                        };
                    }
                }
            }
        }

        // Character is available
        return {
            label: '✓ Available',
            disabled: false,
            style: 'color:var(--accent);'
        };
    }

    // ============================================================
    // CHARACTER ELIGIBILITY - PERIOD-AWARE candidate selection
    // ============================================================

    /**
     * Get candidate characters for a team type at a specific period.
     * This returns characters whose career status AT THE GIVEN PERIOD
     * makes them appropriate for the team type.
     * 
     * This is the PERIOD-AWARE version - it looks at historical status,
     * not just current status.
     * 
     * @param {string} teamType - Team type
     * @param {number|string} period - Period to check (week for academic, year for others)
     * @returns {array} Array of character objects
     */
    function getCandidateCharactersAtPeriod(teamType, period) {
        var data = window.data || {};
        var chars = data.characters || [];
        if (!Array.isArray(chars)) return [];

        // Validate period for team type
        var typedPeriod = parseTypedPeriod(period, teamType);
        if (!typedPeriod) return [];

        var result = [];

        chars.forEach(function(c) {
            if (!c || typeof c !== 'object') return;

            var status = '';
            if (typeof window.getCurrentStatus === 'function') {
                // TODO: Make this period-aware. Currently uses current status.
                // For true historical filtering, we need a getStatusAtPeriod() for characters.
                status = String(window.getCurrentStatus(c) || '').toLowerCase();
            }

            // For now, we use current status as a proxy.
            // In a fully period-aware system, this would check the character's
            // career status at the given period.
            if (teamType === 'academic') {
                if (status === 'trainee' || status.startsWith('trainee')) {
                    result.push(c);
                }
            } else if (teamType === 'civilian') {
                if (status === 'civilian') {
                    result.push(c);
                }
            } else {
                // Professional, temporary, or other non-academic teams
                var isAllowed = false;
                for (var i = 0; i < ALLOWED_NON_CIVILIAN.length; i++) {
                    if (status === ALLOWED_NON_CIVILIAN[i] || status.startsWith(ALLOWED_NON_CIVILIAN[i])) {
                        isAllowed = true;
                        break;
                    }
                }
                if (isAllowed) {
                    result.push(c);
                }
            }
        });

        // Sort by display name
        result.sort(function(a, b) {
            var nameA = window.getDisplayName ? window.getDisplayName(a) : (a.firstName || 'Unknown');
            var nameB = window.getDisplayName ? window.getDisplayName(b) : (b.firstName || 'Unknown');
            return nameA.localeCompare(nameB);
        });

        return result;
    }

    /**
     * Get candidate characters for a team type based on CURRENT status.
     * This is a legacy wrapper for UI that hasn't been updated to use
     * period-aware candidate selection yet.
     * 
     * @deprecated Use getCandidateCharactersAtPeriod() for historical accuracy.
     * @param {string} teamType - Team type
     * @returns {array} Array of character objects
     */
    function getCandidateCharacters(teamType) {
        // Default to current year/period
        var data = window.data || {};
        var defaultPeriod = teamType === 'academic' ? 1 : (data.currentYear || new Date().getFullYear());
        return getCandidateCharactersAtPeriod(teamType, defaultPeriod);
    }

    /**
     * @deprecated Use getCandidateCharactersAtPeriod() instead.
     * Kept for backward compatibility.
     */
    function getEligibleCharacters(teamType) {
        return getCandidateCharacters(teamType);
    }

    // ============================================================
    // RENDER MEMBERS LIST
    // ============================================================

    /**
     * Render members list for a team.
     * PURE: Returns HTML string. Does NOT mutate data or DOM.
     * 
     * @param {object} team - Team object
     * @param {number|string} filterPeriod - Current period
     * @returns {string} HTML string
     */
    function renderList(team, filterPeriod) {
        if (!team || !team.members || team.members.length === 0) {
            return '<p class="empty-state">No members in this team</p>';
        }

        var typedPeriod = parseTypedPeriod(filterPeriod, team.type);
        if (!typedPeriod) {
            return '<p class="empty-state">Invalid period for this team type</p>';
        }

        var periodNum = typedPeriod.value;
        var periodUnit = typedPeriod.unit;
        var periodLabel = team.type === 'academic' ? 'Wk' : 'Period';

        var html = '';

        // Separate current (active/future) and historical (former) members
        var currentMembers = [];
        var historicalMembers = [];

        team.members.forEach(function(member, index) {
            var status = getStatusAtPeriod(member, filterPeriod, team.type);

            if (status === 'active' || status === 'future') {
                currentMembers.push({ member: member, index: index, status: status });
            } else {
                historicalMembers.push({ member: member, index: index, status: status });
            }
        });

        // Sort current by join period
        currentMembers.sort(function(a, b) {
            var aJoin = parsePositivePeriod(a.member.joinPeriod) || 0;
            var bJoin = parsePositivePeriod(b.member.joinPeriod) || 0;
            return aJoin - bJoin;
        });

        // Sort historical by priority
        var priorityOrder = { 'left': 0, 'eliminated': 1, 'deceased': 2, 'unknown': 3 };
        historicalMembers.sort(function(a, b) {
            var aPriority = priorityOrder[a.status] !== undefined ? priorityOrder[a.status] : 4;
            var bPriority = priorityOrder[b.status] !== undefined ? priorityOrder[b.status] : 4;
            if (aPriority !== bPriority) return aPriority - bPriority;

            // Fall back to character name
            var aChar = window.getCharacterById ? window.getCharacterById(a.member.characterId) : null;
            var bChar = window.getCharacterById ? window.getCharacterById(b.member.characterId) : null;
            var aName = aChar ? (window.getDisplayName ? window.getDisplayName(aChar) : 'Unknown') : 'Unknown';
            var bName = bChar ? (window.getDisplayName ? window.getDisplayName(bChar) : 'Unknown') : 'Unknown';
            return aName.localeCompare(bName);
        });

        var allMembers = currentMembers.concat(historicalMembers);

        allMembers.forEach(function(item) {
            var member = item.member;
            var index = item.index;
            var status = item.status;
            var char = window.getCharacterById ? window.getCharacterById(member.characterId) : null;
            var name = char ? (window.getDisplayName ? window.getDisplayName(char) : 'Unknown') : 'Unknown';
            // NOTE: Age is currently current-age, not period-aware.
            // TODO: Add getCharacterAgeAtPeriod() for historical accuracy.
            var age = char ? (window.getCharacterAge ? window.getCharacterAge(char) : '-') : '-';

            var statusInfo = window.TeamCore.getMemberStatusInfo(status);
            var statusColor = statusInfo.color;

            // Build period display with proper formatting
            var joinDisplay = member.joinPeriod || '?';
            var leaveDisplay = member.leavePeriod || '';
            var periodDisplay = team.type === 'academic'
                ? 'Wk ' + joinDisplay + (leaveDisplay ? ' → Wk ' + leaveDisplay : '')
                : joinDisplay + (leaveDisplay ? ' → ' + leaveDisplay : '');

            var statusIcon = '';
            var statusSuffix = '';
            if (status === 'deceased') {
                statusIcon = '✝ ';
                statusSuffix = ' (Deceased)';
            } else if (status === 'eliminated') {
                statusIcon = '⚠ ';
                statusSuffix = ' (Eliminated)';
            } else if (status === 'left') {
                statusIcon = '↩ ';
                statusSuffix = ' (Former)';
            } else if (status === 'future') {
                statusIcon = '⏳ ';
                statusSuffix = ' (Future)';
            } else if (status === 'active') {
                statusIcon = '✓ ';
            } else if (status === 'unknown') {
                statusIcon = '? ';
                statusSuffix = ' (Unknown)';
            }

            // Escape all user-controlled values
            var escapedName = escapeHtml(name);
            var escapedRole = escapeHtml(member.role || 'Member');
            var escapedPeriod = escapeHtml(periodDisplay);
            var escapedAge = escapeHtml(age);
            var escapedStatusLabel = escapeHtml(statusInfo.label);
            var escapedCharId = escapeHtml(member.characterId);

            // Use stable character ID for data attributes, not array index
            var dataCharId = escapeHtml(member.characterId);

            html += '<div class="member-entry" style="border-left:3px solid ' + statusColor + ';padding-left:8px;' +
                (status === 'deceased' ? 'opacity:0.6;' : '') +
                (status === 'left' ? 'opacity:0.7;' : '') +
                (status === 'unknown' ? 'opacity:0.5;' : '') + '" data-character-id="' + dataCharId + '">' +
                '<div class="member-info" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:4px;width:100%;">' +
                '<span><strong>' + escapedName + '</strong></span>' +
                '<span class="role" style="color:var(--accent);font-size:0.75rem;">' + escapedRole + '</span>' +
                '<span class="years" style="color:var(--text-dim);font-size:0.7rem;">' + escapedPeriod + '</span>' +
                '<span class="years" style="color:var(--text-dim);font-size:0.7rem;">Age: ' + escapedAge + '</span>' +
                '<span style="color:' + statusColor + ';font-size:0.7rem;font-weight:600;">' + statusIcon + escapedStatusLabel + statusSuffix + '</span>' +
                '<div class="member-actions" style="display:flex;gap:4px;">' +
                '<button class="small edit-member" data-character-id="' + dataCharId + '">Edit</button>' +
                '<button class="small danger remove-member" data-character-id="' + dataCharId + '">Remove</button>' +
                '</div>' +
                '</div>' +
                '</div>';
        });

        return html;
    }

    // ============================================================
    // PUBLIC API
    // ============================================================

    var TeamMembers = {
        // Status determination - period-aware
        getStatusAtPeriod: getStatusAtPeriod,
        getStatusAtWeek: getStatusAtWeek,

        // Eligibility - period-aware
        getCandidateCharactersAtPeriod: getCandidateCharactersAtPeriod,
        getCandidateCharacters: getCandidateCharacters, // Legacy: current-status based
        getEligibleCharacters: getEligibleCharacters, // Legacy alias
        getEligibilityStatus: getEligibilityStatus,

        // Rendering
        renderList: renderList,

        // Validation helpers (exposed for external use)
        isValidAcademicWeek: isValidAcademicWeek,
        isValidYear: isValidYear,
        parsePositivePeriod: parsePositivePeriod,
        parseTypedPeriod: parseTypedPeriod,

        // Constants
        MIN_WEEK: MIN_WEEK,
        MAX_WEEK: MAX_WEEK,
        MIN_YEAR: MIN_YEAR,
        MAX_YEAR: MAX_YEAR
    };

    // ============================================================
    // EXPOSE
    // ============================================================

    window.TeamMembers = TeamMembers;

})();
