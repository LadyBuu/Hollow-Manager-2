/**
 * js/modules/teams/team-members.js - Team Member Management
 * Handles adding, removing, and managing team members
 * Path: js/modules/teams/team-members.js
 * 
 * IMPORTANT: This module is READ-ONLY for data operations.
 * All mutations are delegated to TeamCore.
 * This module does NOT call saveData().
 * 
 * This module is responsible for:
 *   - Determining member status at a given period (historical timeline engine)
 *   - Determining character eligibility for teams
 *   - Rendering member lists (returns HTML)
 *   - Providing eligibility status for UI display
 * 
 * ELIGIBILITY CONCEPTS:
 *   - Candidate characters: Those whose CURRENT career status makes them
 *     appropriate for a team type (e.g., trainees for academic teams)
 *     NOTE: This is based on current status, not historical period.
 *     For historical team construction, additional filtering may be needed.
 *   - Eligibility status: Whether a candidate can be added to a specific team
 *     at a specific period, with appropriate UI labels and styling
 * 
 * HISTORICAL TIMELINE ENGINE:
 *   - getStatusAtPeriod() is timeline-aware: it answers "what was this
 *     member's status at this point in time?"
 *   - Deceased status is only returned if death occurred at or before the period
 *   - Unknown death dates do NOT override known membership history
 *   - If a death date is unknown, membership history takes precedence
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
 */

(function() {
    'use strict';

    // Guard against duplicate script loading
    if (window.__teamMembersLoaded) {
        return;
    }
    window.__teamMembersLoaded = true;

    // ============================================================
    // DEPENDENCY CHECK
    // ============================================================

    if (!window.TeamCore) {
        console.error('TeamMembers: TeamCore is required but not loaded.');
        return;
    }

    // ============================================================
    // HTML ESCAPING - Prevents XSS
    // ============================================================

    function escapeHtml(value) {
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

    // ============================================================
    // MEMBER STATUS DETERMINATION - Historical timeline engine
    // ============================================================

    /**
     * Get member status at a specific period.
     * Returns status strings: 'active', 'left', 'future', 'deceased', 'eliminated', 'unknown'
     * 
     * This is a TIMELINE-AWARE engine:
     * - A character is only deceased if their death occurred at or before the given period
     * - Unknown death dates do NOT override known membership history
     * - If death date is unknown, membership history takes precedence
     * - Eliminations are checked at or before the given period
     * 
     * @param {object} member - Member object (must have characterId, joinPeriod, leavePeriod)
     * @param {number|string} period - Period (week or year)
     * @param {string} teamType - Team type (for future use)
     * @returns {string} Status string
     */
    function getStatusAtPeriod(member, period, teamType) {
        if (!member || typeof member !== 'object') return 'unknown';

        var periodNum = parsePositivePeriod(period);
        if (periodNum === null) {
            return 'unknown';
        }

        var char = window.getCharacterById ? window.getCharacterById(member.characterId) : null;

        // Check if character is deceased AT OR BEFORE this period
        if (char && char.deceased) {
            var deathYear = parsePositivePeriod(char.deathYear);
            if (deathYear !== null) {
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

        // Check if character is eliminated AT OR BEFORE this period
        // Note: Eliminations are global in this model (uses weeks as timeline)
        if (char && char.eliminatedWeeks && Array.isArray(char.eliminatedWeeks)) {
            for (var i = 0; i < char.eliminatedWeeks.length; i++) {
                var elimWeek = parsePositivePeriod(char.eliminatedWeeks[i]);
                if (elimWeek !== null && elimWeek <= periodNum) {
                    return 'eliminated';
                }
            }
        }

        // Check membership status
        var join = parsePositivePeriod(member.joinPeriod);
        var leave = parsePositivePeriod(member.leavePeriod);

        // If no join period, treat as unknown
        if (join === null) {
            return 'unknown';
        }

        // Future member: join is in the future
        if (join > periodNum) {
            return 'future';
        }

        // Active member: join <= period and (no leave or leave >= period)
        if (leave === null || leave >= periodNum) {
            return 'active';
        }

        // Otherwise, they've left
        return 'left';
    }

    /**
     * Get member status at a specific week (academic teams).
     * Convenience wrapper for getStatusAtPeriod.
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
        var periodNum = parsePositivePeriod(currentPeriod);
        if (periodNum === null) {
            return {
                label: 'Invalid period',
                disabled: true,
                style: 'color:var(--text-dim);'
            };
        }

        // Find the actual member record if the character is in this team
        var existingMember = null;
        if (team.members && Array.isArray(team.members)) {
            existingMember = team.members.find(function(member) {
                return member && String(member.characterId) === String(charId);
            });
        }

        // If character is in this team, check their status
        if (existingMember) {
            var memberStatus = getStatusAtPeriod(
                existingMember,
                periodNum,
                team.type
            );

            if (memberStatus === 'active' || memberStatus === 'future') {
                return {
                    label: '✓ In Team',
                    disabled: true,
                    style: 'color:var(--accent);font-weight:bold;'
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

        // Character deceased (timeline-aware)
        if (char.deceased) {
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

        // Character eliminated (timeline-aware)
        if (char.eliminatedWeeks && Array.isArray(char.eliminatedWeeks)) {
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
        var data = window.data || {};
        if (Array.isArray(data.teams)) {
            for (var i = 0; i < data.teams.length; i++) {
                var otherTeam = data.teams[i];
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
                        periodNum,
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
    // CHARACTER ELIGIBILITY - Candidate selection (current status based)
    // ============================================================

    /**
     * Get candidate characters for a team type.
     * This returns characters whose CURRENT career status makes them appropriate
     * for the team type, regardless of their current team membership.
     * 
     * NOTE: This is based on CURRENT status, not historical period.
     * For historical team construction, additional filtering may be needed.
     * 
     * @param {string} teamType - Team type
     * @returns {array} Array of character objects
     */
    function getCandidateCharacters(teamType) {
        var data = window.data || {};
        var chars = data.characters || [];
        if (!Array.isArray(chars)) return [];

        var result = [];

        chars.forEach(function(c) {
            if (!c || typeof c !== 'object') return;

            var status = '';
            if (typeof window.getCurrentStatus === 'function') {
                status = String(window.getCurrentStatus(c) || '').toLowerCase();
            }

            if (teamType === 'academic') {
                if (status === 'trainee' || status.startsWith('trainee')) {
                    result.push(c);
                }
            } else if (teamType === 'civilian') {
                if (status === 'civilian') {
                    result.push(c);
                }
            } else {
                var allowedStatuses = ['trainee', 'rookie', 'junior', 'senior', 'instructor', 'support'];
                var isAllowed = false;
                for (var i = 0; i < allowedStatuses.length; i++) {
                    if (status === allowedStatuses[i] || status.startsWith(allowedStatuses[i])) {
                        isAllowed = true;
                        break;
                    }
                }
                if (isAllowed) {
                    result.push(c);
                }
            }
        });

        return result;
    }

    /**
     * @deprecated Use getCandidateCharacters() instead.
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

        var periodLabel = team.type === 'academic' ? 'Wk' : 'Period';
        var periodNum = parsePositivePeriod(filterPeriod);
        if (periodNum === null) {
            periodNum = 1;
        }

        var html = '';

        // Separate current (active/future) and historical (former) members
        var currentMembers = [];
        var historicalMembers = [];

        team.members.forEach(function(member, index) {
            var status = getStatusAtPeriod(member, periodNum, team.type);

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

        // Sort historical by priority (unknown goes to bottom)
        historicalMembers.sort(function(a, b) {
            var priorityMap = {
                'left': 0,
                'eliminated': 1,
                'deceased': 2,
                'unknown': 3
            };
            var aPriority = priorityMap[a.status] !== undefined ? priorityMap[a.status] : 4;
            var bPriority = priorityMap[b.status] !== undefined ? priorityMap[b.status] : 4;
            if (aPriority !== bPriority) return aPriority - bPriority;

            // Fall back to character name if same priority
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
            var age = char ? (window.getCharacterAge ? window.getCharacterAge(char) : '-') : '-';

            var statusInfo = window.TeamCore.getMemberStatusInfo(status);
            var statusColor = statusInfo.color; // Internal constant, safe
            var periodDisplay = periodLabel + (member.joinPeriod || '?');
            if (member.leavePeriod) {
                periodDisplay += ' → ' + periodLabel + member.leavePeriod;
            }

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

            html += '<div class="member-entry" style="border-left:3px solid ' + statusColor + ';padding-left:8px;' +
                (status === 'deceased' ? 'opacity:0.6;' : '') +
                (status === 'left' ? 'opacity:0.7;' : '') +
                (status === 'unknown' ? 'opacity:0.5;' : '') + '" data-member-index="' + index + '">' +
                '<div class="member-info" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:4px;width:100%;">' +
                '<span><strong>' + escapedName + '</strong></span>' +
                '<span class="role" style="color:var(--accent);font-size:0.75rem;">' + escapedRole + '</span>' +
                '<span class="years" style="color:var(--text-dim);font-size:0.7rem;">' + escapedPeriod + '</span>' +
                '<span class="years" style="color:var(--text-dim);font-size:0.7rem;">Age: ' + escapedAge + '</span>' +
                '<span style="color:' + statusColor + ';font-size:0.7rem;font-weight:600;">' + statusIcon + escapedStatusLabel + statusSuffix + '</span>' +
                '<div class="member-actions" style="display:flex;gap:4px;">' +
                '<button class="small edit-member" data-index="' + index + '">Edit</button>' +
                '<button class="small danger remove-member" data-char="' + escapedCharId + '">Remove</button>' +
                '</div>' +
                '</div>' +
                '</div>';
        });

        return html;
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.TeamMembers = {
        getStatusAtPeriod: getStatusAtPeriod,
        getStatusAtWeek: getStatusAtWeek,
        getCandidateCharacters: getCandidateCharacters,
        getEligibleCharacters: getEligibleCharacters, // Legacy alias
        getEligibilityStatus: getEligibilityStatus,
        renderList: renderList
    };

})();
