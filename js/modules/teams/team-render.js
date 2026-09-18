/**
 * modules/teams/team-render.js - Team Rendering
 * Pure rendering for team lists and team data.
 *
 * Path: js/modules/teams/team-render.js
 *
 * This module provides:
 *   - renderList(vm)              - team list rows
 *   - renderExpandedMembers(vm)   - expanded member section
 *   - renderTeamCard(vm)          - compact team card
 *   - renderTeamSummary(vm)       - single-line summary
 *   - renderContainer(vm)         - full page shell
 *   - renderFilterBar(filterVM)   - filter bar
 *   - renderMemberList(membersVM) - member rows (per interval)
 *   - renderRankingList(rankVM)   - ranking rows
 *   - renderTeamForm(formVM)      - team form markup
 *   - renderMemberForm(formVM)    - member form markup
 *   - renderRankingForm(formVM)   - ranking form markup
 *   - getModalsHTML()             - static modal shells
 *
 * IMPORTANT:
 *   - RENDER ONLY. No queries, no state, no mutations, no domain
 *     calculations.
 *   - Every input is a view model already produced by TeamAggregator.
 *   - Uses DomUtils for escaping. No other dependency.
 *   - Every display string (type label, period display, rank display,
 *     member status label) is supplied by the VM. The renderer does
 *     not derive display strings from domain data.
 *
 * MEMBER INTERVALS (v24):
 *   A member VM carries:
 *     {
 *       characterId, memberId, displayName, status, age, deceased,
 *       role,
 *       intervals: [
 *         { joinPeriod, leavePeriod, activeAtPeriod },
 *         ...
 *       ],
 *       joinPeriod, leavePeriod,   // convenience: first interval's
 *       activeAtPeriod
 *     }
 *
 *   renderExpandedMembers iterates the intervals array to produce one
 *   sub-line per stint.
 *
 *   renderMemberList produces ONE ROW PER INTERVAL. Each row carries
 *   data-character-id and data-join-period so the caller can address
 *   the specific stint.
 *
 *   renderMemberForm edits ONE interval, identified by
 *   data-character-id and data-join-period. joinPeriod is read-only
 *   (immutable); role and leavePeriod are editable. Role applies to
 *   the whole member entry, not the single stint.
 *
 *   NOTE (BUG-E13): the .edit-member button that used to appear on
 *   each compact-modal member row has been removed. Per-stint editing
 *   is now handled by the full member manager
 *   (TeamEvents.openMemberManager), which renders the same markup as
 *   the academic member manager. The compact modal still supports
 *   adding members and removing stints; it no longer offers a
 *   single-row editor.
 *
 * TEAM LIST MARKUP (mobile contract):
 *   renderList emits each team as a five-cell row. The first cell is
 *   wrapped in .team-name-cell so the mobile card layout can flow it
 *   as a flex row (name + type badge + inactive marker). The other
 *   four cells carry their existing classes (.team-period,
 *   .team-rank, .team-member-count, .actions).
 *
 *   The desktop grid reads --team-columns from #team-list-container,
 *   which renderContainer emits.
 *
 * FILTER BAR:
 *   The filter bar is rendered here from a filter VM supplied by
 *   TeamAggregator.getFilterBarViewModel(tab).
 *
 * DEPENDENCIES:
 *   - window.DomUtils (MANDATORY)
 *
 * USAGE:
 *   var html = TeamRender.renderList(listVM);
 *   container.innerHTML = TeamRender.renderContainer(pageVM);
 */

(function() {
    'use strict';

    if (window.__teamRenderLoaded) {
        return;
    }
    window.__teamRenderLoaded = true;

    // ============================================================
    // DEPENDENCY IMPORT
    // ============================================================

    var DomUtils = window.DomUtils;

    // ============================================================
    // DEPENDENCY CHECK
    // ============================================================

    function checkDependencies() {
        var missing = [];

        if (!DomUtils || typeof DomUtils.escapeHtml !== 'function') {
            missing.push('DomUtils.escapeHtml');
        }
        if (!DomUtils || typeof DomUtils.escapeAttribute !== 'function') {
            missing.push('DomUtils.escapeAttribute');
        }

        if (missing.length > 0) {
            console.warn('[TeamRender] Missing dependencies:', missing.join(', '));
            return false;
        }

        return true;
    }

    checkDependencies();

    // ============================================================
    // ESCAPING
    // ============================================================

    function escapeHtml(value) {
        return DomUtils.escapeHtml(value);
    }

    function escapeAttribute(value) {
        return DomUtils.escapeAttribute(value);
    }

    // ============================================================
    // SMALL HELPERS
    // ============================================================

    function isNonEmptyString(value) {
        return typeof value === 'string' && value.trim() !== '';
    }

    function safeString(value) {
        return value === undefined || value === null ? '' : String(value);
    }

    // ============================================================
    // SHARED FRAGMENTS
    // ============================================================

    function renderTeamActions(teamId, isExpanded) {
        var idAttr = escapeAttribute(teamId);
        var caret = isExpanded ? '\u25be' : '\u25b8';
        var ariaLabel = isExpanded ? 'Collapse team members' : 'Expand team members';
        var ariaExpanded = isExpanded ? 'true' : 'false';

        var html = '';
        html += '<button class="small toggle-members" ' +
                    'data-id="' + idAttr + '" ' +
                    'aria-label="' + escapeAttribute(ariaLabel) + '" ' +
                    'aria-expanded="' + escapeAttribute(ariaExpanded) + '">' +
                    caret +
                '</button>';
        html += '<button class="small manage-members" data-id="' + idAttr + '">Members</button>';
        html += '<button class="small manage-rankings" data-id="' + idAttr + '">Rankings</button>';
        html += '<button class="small edit-team" data-id="' + idAttr + '">Edit</button>';
        html += '<button class="small danger delete-team" data-id="' + idAttr + '">Delete</button>';
        return html;
    }

    // ============================================================
    // TEAM LIST
    // ============================================================

    function renderList(listVM, type, expandedTeamId, expandedMembersVM) {
        if (!listVM || !Array.isArray(listVM.teams)) {
            return '<p class="empty-state" style="padding:20px;">No teams found.</p>';
        }

        var teams = listVM.teams;

        if (teams.length === 0) {
            var labels = {
                'professional': 'professional teams',
                'temporary': 'temporary teams',
                'civilian': 'civilian teams',
                'academic': 'academic teams'
            };
            var label = labels[type] || 'teams';
            return '<p class="empty-state" style="padding:20px;">No ' + escapeHtml(label) + ' found.</p>';
        }

        var html = '';
        html += '<div class="list-header team-header">';
        html += '<span>Team Name</span>';
        html += '<span>Period</span>';
        html += '<span>Rank</span>';
        html += '<span>Members</span>';
        html += '<span>Actions</span>';
        html += '</div>';

        for (var i = 0; i < teams.length; i++) {
            var team = teams[i];
            if (!team || !team.id) {
                continue;
            }

            var isExpanded = expandedTeamId &&
                String(expandedTeamId) === String(team.id);

            var rowClass = 'list-item team-item';
            if (!team.isActive) {
                rowClass += ' inactive';
            }

            html += '<div class="' + rowClass + '" ' +
                        'data-id="' + escapeAttribute(team.id) + '">';

            html += '<span class="team-name-cell">';
            html += '<strong>' + escapeHtml(team.name || 'Unnamed Team') + '</strong>';
            if (isNonEmptyString(team.classDisplay)) {
                html += ' <span class="team-class">[' +
                            escapeHtml(team.classDisplay) +
                        ']</span>';
            }
            html += ' <span class="team-type-label">' +
                        escapeHtml(team.typeLabel || team.type || '') +
                    '</span>';
            if (!team.isActive) {
                html += ' <span class="team-status-inactive">(Inactive)</span>';
            }
            html += '</span>';

            html += '<span class="team-period">' +
                        escapeHtml(team.periodDisplay || '-') +
                    '</span>';

            html += '<span class="team-rank">' +
                        escapeHtml(team.currentRank || '-') +
                    '</span>';

            html += '<span class="team-member-count">' +
                        safeString(team.activeMemberCount) +
                    '</span>';

            html += '<span class="actions">' +
                        renderTeamActions(team.id, isExpanded) +
                    '</span>';

            html += '</div>';

            if (isExpanded && expandedMembersVM) {
                html += renderExpandedMembers(expandedMembersVM);
            }
        }

        return html;
    }

    // ============================================================
    // EXPANDED MEMBERS
    // ============================================================
    //
    // One block per member, one sub-line per interval.
    //
    // The member VM carries `intervals[]`; each interval has its own
    // periodDisplay. The renderer prints one sub-line per interval.

    function renderExpandedMembers(membersVM) {
        if (!membersVM) {
            return '';
        }

        var periodLabel = membersVM.periodLabel || 'Period';
        var period = membersVM.period;
        var allMembers = Array.isArray(membersVM.members) ? membersVM.members : [];

        // Filter to members active at the display period. The VM
        // already flags `activeAtPeriod` on each entry.
        var activeMembers = allMembers.filter(function(m) {
            return m && m.activeAtPeriod;
        });

        var html = '<div class="team-members-expanded" ' +
                        'data-team-id="' + escapeAttribute(membersVM.teamId) + '">';

        if (activeMembers.length === 0) {
            html += '<div class="member-entry empty">No active members this ' +
                        escapeHtml(periodLabel.toLowerCase()) +
                    '</div>';
            html += '</div>';
            return html;
        }

        var labelText = 'Active Members in ' + periodLabel + ' ' + safeString(period) + ':';
        html += '<div class="members-expanded-header">' +
                    escapeHtml(labelText) +
                '</div>';

        for (var i = 0; i < activeMembers.length; i++) {
            var member = activeMembers[i];

            html += '<div class="member-entry" ' +
                        'data-character-id="' +
                            escapeAttribute(member.characterId || '') + '">';

            // ---- Header line: name, role, age, status ----
            html += '<div class="member-entry-header">';
            html += '<span class="member-entry-name">' +
                        escapeHtml(member.displayName || 'Unknown') +
                    '</span> ';
            html += '<span class="member-entry-role">(' +
                        escapeHtml(member.role || 'Member') +
                    ')</span> ';

            if (isNonEmptyString(member.age) && member.age !== '-') {
                html += '<span class="member-entry-age">Age: ' +
                            escapeHtml(member.age) +
                        '</span> ';
            }

            if (isNonEmptyString(member.status)) {
                html += '<span class="member-entry-status">' +
                            escapeHtml(member.status) +
                        '</span>';
            }
            html += '</div>';

            // ---- Stint sub-lines ----
            var intervals = Array.isArray(member.intervals) ? member.intervals : [];

            if (intervals.length === 0) {
                html += '<div class="member-entry-intervals">';
                html += '<div class="member-entry-interval empty">' +
                            'No stints recorded.' +
                        '</div>';
                html += '</div>';
            } else {
                html += '<div class="member-entry-intervals">';
                for (var j = 0; j < intervals.length; j++) {
                    var iv = intervals[j];
                    if (!iv || typeof iv !== 'object') { continue; }

                    var rowClass = 'member-entry-interval';
                    if (iv.activeAtPeriod) {
                        rowClass += ' active';
                    }

                    html += '<div class="' + rowClass + '" ' +
                                'data-join-period="' +
                                    escapeAttribute(iv.joinPeriod || '') + '">';
                    html += '<span class="member-entry-interval-period">' +
                                escapeHtml(
                                    iv.periodDisplay ||
                                    formatFallbackInterval(iv)
                                ) +
                            '</span>';
                    html += '</div>';
                }
                html += '</div>';
            }

            html += '</div>';
        }

        html += '</div>';
        return html;
    }

    /**
     * Fallback period display for an interval whose VM doesn't carry
     * a pre-computed display string.
     */
    function formatFallbackInterval(iv) {
        var join = iv && isNonEmptyString(iv.joinPeriod) ? iv.joinPeriod : '';
        var leave = iv && isNonEmptyString(iv.leavePeriod) ? iv.leavePeriod : '';
        if (join && leave) { return join + ' \u2013 ' + leave; }
        if (join) { return join + ' \u2013'; }
        if (leave) { return 'Until ' + leave; }
        return '\u2014';
    }

    // ============================================================
    // TEAM CARD
    // ============================================================

    function renderTeamCard(team) {
        if (!team || !team.id) {
            return '';
        }

        var cardClass = 'team-card';
        if (!team.isActive) {
            cardClass += ' inactive';
        }

        var html = '<div class="' + cardClass + '" ' +
                        'data-id="' + escapeAttribute(team.id) + '">';

        html += '<div class="team-card-header">';
        html += '<strong>' + escapeHtml(team.name || 'Unnamed Team') + '</strong>';
        if (isNonEmptyString(team.classDisplay)) {
            html += ' <span class="team-class">[' +
                        escapeHtml(team.classDisplay) +
                    ']</span>';
        }
        html += ' <span class="team-type-label">' +
                    escapeHtml(team.typeLabel || team.type || '') +
                '</span>';
        if (!team.isActive) {
            html += ' <span class="team-status-inactive">(Inactive)</span>';
        }
        html += '</div>';

        html += '<div class="team-card-details">';
        html += '<span class="team-period">' +
                    escapeHtml(team.periodDisplay || '-') +
                '</span>';
        html += '<span class="team-rank">Rank: ' +
                    escapeHtml(team.currentRank || '-') +
                '</span>';
        html += '<span class="team-member-count">Members: ' +
                    safeString(team.activeMemberCount) +
                '</span>';
        html += '</div>';

        html += '<div class="team-card-actions">';
        html += renderTeamActions(team.id, false);
        html += '</div>';

        html += '</div>';
        return html;
    }

    // ============================================================
    // TEAM SUMMARY
    // ============================================================

    function renderTeamSummary(team) {
        if (!team || !team.id) {
            return '';
        }

        var html = '<div class="team-summary">';
        html += '<span class="team-name">' + escapeHtml(team.name || 'Unnamed Team') + '</span>';
        html += '<span class="team-type">' + escapeHtml(team.typeLabel || team.type || '') + '</span>';
        html += '<span class="team-rank">#' + escapeHtml(team.currentRank || '-') + '</span>';
        html += '<span class="team-members">' +
                    safeString(team.activeMemberCount) +
                    ' active members' +
                '</span>';
        html += '</div>';

        return html;
    }

    // ============================================================
    // FILTER BAR
    // ============================================================

    function renderFilterBar(filterVM) {
        if (!filterVM || !filterVM.tab) {
            return '';
        }

        var tab = filterVM.tab;
        var periodLabel = filterVM.periodLabel || 'Year';
        var yearValue = filterVM.filterYear !== undefined && filterVM.filterYear !== null
            ? filterVM.filterYear
            : '';
        var status = filterVM.filterStatus || 'active';

        if (tab === 'civilian') {
            return [
                '<div class="filter-row">',
                    '<div class="filter-group">',
                        '<label for="civilian-show-inactive">Show Inactive:</label>',
                        '<input type="checkbox" id="civilian-show-inactive"' +
                            (status === 'inactive' ? ' checked' : '') + '>',
                    '</div>',
                    '<button id="apply-filter-btn" class="small primary" type="button">Apply</button>',
                '</div>'
            ].join('');
        }

        return [
            '<div class="filter-row">',
                '<div class="filter-group">',
                    '<label for="team-filter-year">' +
                        escapeHtml(periodLabel) +
                    ':</label>',
                    '<input type="number" id="team-filter-year" ' +
                        'value="' + escapeAttribute(safeString(yearValue)) + '" ' +
                        'placeholder="All">',
                '</div>',
                '<div class="filter-group">',
                    '<label for="' + escapeAttribute(tab) + '-show-inactive">' +
                        'Show Inactive:' +
                    '</label>',
                    '<input type="checkbox" id="' + escapeAttribute(tab) + '-show-inactive"' +
                        (status === 'inactive' ? ' checked' : '') + '>',
                '</div>',
                '<button id="apply-filter-btn" class="small primary" type="button">Apply</button>',
            '</div>'
        ].join('');
    }

    // ============================================================
    // MEMBER LIST (Teams tab modal — compact)
    // ============================================================
    //
    // ONE ROW PER INTERVAL.
    //
    // The first interval row of a member shows the member's name.
    // Subsequent rows are visually indented under it. Each row
    // carries data-character-id and data-join-period so the caller
    // can address the specific stint.
    //
    // Members with intervals: [] show a single "no stints" row with
    // a Remove-member action, since there's no stint to act on.
    //
    // NOTE (BUG-E13): the per-row .edit-member button has been
    // removed. Per-stint editing is handled by the full member
    // manager (TeamEvents.openMemberManager). The compact modal
    // still supports adding members and removing stints.

    function renderMemberList(membersVM) {
        if (!membersVM || !Array.isArray(membersVM.members)) {
            return '<p class="empty-state">No members in this team</p>';
        }

        var members = membersVM.members;
        if (members.length === 0) {
            return '<p class="empty-state">No members in this team</p>';
        }

        var html = '';

        for (var i = 0; i < members.length; i++) {
            var member = members[i];
            if (!member || !member.characterId) { continue; }

            var intervals = Array.isArray(member.intervals)
                ? member.intervals
                : [];

            if (intervals.length === 0) {
                // Placeholder row: member exists but has no stints.
                html += renderMemberPlaceholderRow(member);
                continue;
            }

            for (var j = 0; j < intervals.length; j++) {
                var iv = intervals[j];
                if (!iv || typeof iv !== 'object') { continue; }
                html += renderMemberIntervalRow(member, iv, j === 0);
            }
        }

        return html;
    }

    /**
     * Render one interval row for a member.
     *
     * `isFirstRowForMember` controls whether the member name is shown.
     * The member name appears on the first row only; subsequent rows
     * show an indented continuation.
     */
    function renderMemberIntervalRow(member, interval, isFirstRowForMember) {
        var joinAttr = escapeAttribute(interval.joinPeriod || '');
        var charAttr = escapeAttribute(member.characterId);
        var memberIdAttr = escapeAttribute(member.memberId || '');

        var joinDisplay = isNonEmptyString(interval.joinPeriod)
            ? interval.joinPeriod
            : '\u2014';
        var leaveDisplay = isNonEmptyString(interval.leavePeriod)
            ? interval.leavePeriod
            : '\u2014';

        var rowClass = 'member-entry member-interval-row';
        if (!interval.activeAtPeriod) {
            rowClass += ' member-entry-inactive';
        }
        if (!isFirstRowForMember) {
            rowClass += ' member-interval-continuation';
        }

        var html = '';
        html += '<div class="' + rowClass + '" ' +
                    'data-character-id="' + charAttr + '" ' +
                    'data-member-id="' + memberIdAttr + '" ' +
                    'data-join-period="' + joinAttr + '">';

        // ---- Left: name (first row only) + interval bounds ----
        html += '<div class="member-interval-left">';
        if (isFirstRowForMember) {
            html += '<span class="member-name">' +
                        '<strong>' + escapeHtml(member.displayName || 'Unknown') + '</strong>' +
                    '</span> ';
            html += '<span class="member-role">(' +
                        escapeHtml(member.role || 'Member') +
                    ')</span>';
        } else {
            html += '<span class="member-name-continuation">\u21b3</span>';
        }
        html += '</div>';

        // ---- Middle: bounds ----
        html += '<div class="member-interval-bounds">';
        html += '<span class="member-join">Join: ' +
                    escapeHtml(joinDisplay) +
                '</span>';
        html += '<span class="member-leave">Leave: ' +
                    escapeHtml(leaveDisplay) +
                '</span>';
        html += '</div>';

        // ---- Right: per-interval actions ----
        //
        // Only Remove is emitted. The .edit-member button has been
        // removed; per-stint editing lives in the full member
        // manager. See the file header for details.
        html += '<div class="member-interval-actions">';
        html += '<button type="button" class="small danger remove-member" ' +
                    'data-character-id="' + charAttr + '" ' +
                    'data-member-id="' + memberIdAttr + '" ' +
                    'data-join-period="' + joinAttr + '" ' +
                    'style="font-size:0.6rem;padding:2px 6px;">\u2715</button>';
        html += '</div>';

        html += '</div>';
        return html;
    }

    /**
     * Render a placeholder row for a member entry that has no
     * intervals. The only available action is Remove-member
     * (delete the whole entry).
     */
    function renderMemberPlaceholderRow(member) {
        var charAttr = escapeAttribute(member.characterId);
        var memberIdAttr = escapeAttribute(member.memberId || '');

        var html = '';
        html += '<div class="member-entry member-entry-placeholder" ' +
                    'data-character-id="' + charAttr + '" ' +
                    'data-member-id="' + memberIdAttr + '">';

        html += '<div class="member-interval-left">';
        html += '<span class="member-name">' +
                    '<strong>' + escapeHtml(member.displayName || 'Unknown') + '</strong>' +
                '</span> ';
        html += '<span class="member-role">(' +
                    escapeHtml(member.role || 'Member') +
                ')</span>';
        html += '</div>';

        html += '<div class="member-interval-bounds">';
        html += '<span class="member-placeholder">No stints recorded.</span>';
        html += '</div>';

        html += '<div class="member-interval-actions">';
        html += '<button type="button" class="small danger remove-member-entry" ' +
                    'data-character-id="' + charAttr + '" ' +
                    'data-member-id="' + memberIdAttr + '" ' +
                    'style="font-size:0.6rem;padding:2px 6px;">Remove member</button>';
        html += '</div>';

        html += '</div>';
        return html;
    }

    // ============================================================
    // RANKING LIST
    // ============================================================

    function renderRankingList(rankVM) {
        if (!rankVM || !Array.isArray(rankVM.history) || rankVM.history.length === 0) {
            return '<p class="empty-state">No ranking history</p>';
        }

        var history = rankVM.history;
        var html = '';

        for (var i = 0; i < history.length; i++) {
            var entry = history[i];
            if (!entry) { continue; }

            html += '<div class="ranking-entry" ' +
                        'style="display:flex;justify-content:space-between;align-items:center;padding:4px 8px;border-bottom:1px solid var(--border-soft);">';
            html += '<span>Period: <strong>' + escapeHtml(entry.period) +
                        '</strong> \u2192 Rank: <strong>#' +
                        escapeHtml(String(entry.rank)) +
                    '</strong></span>';
            html += '<button type="button" class="small danger remove-ranking" ' +
                        'data-period="' + escapeAttribute(entry.period) + '" ' +
                        'style="font-size:0.6rem;padding:2px 6px;">\u2715</button>';
            html += '</div>';
        }

        return html;
    }

    // ============================================================
    // TEAM FORM
    // ============================================================

    function renderTeamForm(formVM) {
        if (!formVM) {
            return '';
        }

        var isEdit = formVM.isEdit === true;

        var classOptions = '';
        for (var i = 0; i < formVM.classOptions.length; i++) {
            var opt = formVM.classOptions[i];
            var selected = String(formVM.classId) === String(opt.id) ? ' selected' : '';
            classOptions += '<option value="' + escapeAttribute(opt.id) + '"' +
                                selected + '>' +
                                escapeHtml(opt.name) +
                            '</option>';
        }

        var missionOptions = '';
        for (var j = 0; j < formVM.missionOptions.length; j++) {
            var mOpt = formVM.missionOptions[j];
            var mSelected = String(formVM.temporaryMission) === String(mOpt.id) ? ' selected' : '';
            var mSuffix = mOpt.status === 'completed' ? ' (completed)' : '';
            missionOptions += '<option value="' + escapeAttribute(mOpt.id) + '"' +
                                  mSelected + '>' +
                                  escapeHtml(mOpt.title + mSuffix) +
                              '</option>';
        }

        var statusOptions = ['active', 'inactive', 'deprecated'];
        var statusHtml = '';
        for (var k = 0; k < statusOptions.length; k++) {
            var s = statusOptions[k];
            var sSelected = formVM.status === s ? ' selected' : '';
            statusHtml += '<option value="' + escapeAttribute(s) + '"' + sSelected + '>' +
                              escapeHtml(s.charAt(0).toUpperCase() + s.slice(1)) +
                          '</option>';
        }

        var html = '';

        html += '<form id="team-form-inner" data-edit-id="' +
                    (isEdit ? escapeAttribute(formVM.teamId) : '') + '">';

        html += '<div class="form-grid">';

        html += '<div class="form-group full-width">';
        html += '<label for="team-name">Team Name *</label>';
        html += '<input type="text" id="team-name" value="' +
                    escapeAttribute(formVM.name) + '" required>';
        html += '</div>';

        html += '<div class="form-group">';
        html += '<label for="team-type">Team Type *</label>';
        html += '<select id="team-type" required>';
        var typeOptions = ['professional', 'temporary', 'civilian'];
        for (var t = 0; t < typeOptions.length; t++) {
            var type = typeOptions[t];
            var tSelected = formVM.type === type ? ' selected' : '';
            html += '<option value="' + escapeAttribute(type) + '"' + tSelected + '>' +
                        escapeHtml(type.charAt(0).toUpperCase() + type.slice(1)) +
                    '</option>';
        }
        html += '</select>';
        html += '</div>';

        html += '<div class="form-group">';
        html += '<label for="team-start">Start Period</label>';
        html += '<input type="text" id="team-start" value="' +
                    escapeAttribute(formVM.startPeriod) + '" placeholder="Year">';
        html += '</div>';

        html += '<div class="form-group">';
        html += '<label for="team-end">End Period (optional)</label>';
        html += '<input type="text" id="team-end" value="' +
                    escapeAttribute(formVM.endPeriod) + '" placeholder="Year">';
        html += '</div>';

        html += '<div class="form-group">';
        html += '<label for="team-class">Class</label>';
        html += '<select id="team-class">';
        html += '<option value="">Unassigned</option>';
        html += classOptions;
        html += '</select>';
        html += '</div>';

        html += '<div class="form-group">';
        html += '<label for="team-number">Team Number</label>';
        html += '<input type="text" id="team-number" value="' +
                    escapeAttribute(formVM.teamNumber) + '">';
        html += '</div>';

        html += '<div class="form-group">';
        html += '<label>Current Ranking</label>';
        html += '<input type="text" value="' +
                    escapeAttribute(formVM.currentRank || '-') +
                '" readonly disabled>';
        html += '<span class="field-hint">' +
                    '(Read-only; use Rankings to modify)' +
                '</span>';
        html += '</div>';

        html += '<div class="form-group">';
        html += '<label for="team-status">Status</label>';
        html += '<select id="team-status">' + statusHtml + '</select>';
        html += '</div>';

        html += '<div class="form-group full-width" id="temporary-mission-field">';
        html += '<label for="team-mission">Associated Mission</label>';
        html += '<select id="team-mission">';
        html += '<option value="">None</option>';
        html += missionOptions;
        html += '</select>';
        html += '</div>';

        html += '<div class="form-group full-width">';
        html += '<label>Name History</label>';
        html += '<div id="name-history-container">';
        if (formVM.nameHistory && formVM.nameHistory.length > 0) {
            for (var h = 0; h < formVM.nameHistory.length; h++) {
                html += renderNameHistoryRow(formVM.nameHistory[h]);
            }
        } else {
            html += renderNameHistoryRow(null);
        }
        html += '</div>';
        html += '<button type="button" id="add-name-history-btn" class="small" ' +
                    'style="margin-top:8px;">+ Add Name Period</button>';
        html += '</div>';

        html += '</div>';

        html += '<div class="form-actions">';
        html += '<button type="button" id="cancel-team-form" class="secondary">Cancel</button>';
        html += '<button type="submit" id="save-team-btn" class="primary">' +
                    (isEdit ? 'Save Team' : 'Create Team') +
                '</button>';
        html += '</div>';

        html += '</form>';

        return html;
    }

    function renderNameHistoryRow(entry) {
        var e = entry || {};
        var html = '';
        html += '<div class="name-history-entry" ' +
                    'style="display:flex;gap:6px;margin-bottom:4px;flex-wrap:wrap;align-items:center;">';
        html += '<input type="text" class="name-history-name" placeholder="Team Name" ' +
                    'value="' + escapeAttribute(e.name || '') + '" ' +
                    'style="flex:1;min-width:80px;padding:4px 6px;background:var(--panel-alt);border:1px solid var(--border);color:var(--text);border-radius:4px;font-size:0.7rem;">';
        html += '<input type="text" class="name-history-start" placeholder="Start" ' +
                    'value="' + escapeAttribute(e.startPeriod || '') + '" ' +
                    'style="flex:1;min-width:60px;padding:4px 6px;background:var(--panel-alt);border:1px solid var(--border);color:var(--text);border-radius:4px;font-size:0.7rem;">';
        html += '<input type="text" class="name-history-end" placeholder="End" ' +
                    'value="' + escapeAttribute(e.endPeriod || '') + '" ' +
                    'style="flex:1;min-width:60px;padding:4px 6px;background:var(--panel-alt);border:1px solid var(--border);color:var(--text);border-radius:4px;font-size:0.7rem;">';
        html += '<button type="button" class="small danger remove-name" ' +
                    'style="padding:2px 6px;font-size:0.6rem;">x</button>';
        html += '</div>';
        return html;
    }

    // ============================================================
    // MEMBER FORM (edit one interval)
    // ============================================================
    //
    // The form edits ONE interval, identified by data-character-id
    // and data-join-period.
    //
    // Editable:
    //   - role (applies to the whole member entry)
    //   - leavePeriod (this interval's leave week)
    //
    // Read-only:
    //   - character (display)
    //   - joinPeriod (immutable per the interval model)
    //
    // NOTE (BUG-E13): renderMemberForm is no longer invoked by
    // TeamEvents. It is retained here as a standalone renderer for
    // any caller that still wants the single-interval editor markup.
    // The current Teams tab does not open it.

    function renderMemberForm(formVM) {
        if (!formVM || !formVM.characterId) {
            return '';
        }

        var joinDisplay = isNonEmptyString(formVM.joinPeriod)
            ? formVM.joinPeriod
            : '\u2014';

        var leaveValue = isNonEmptyString(formVM.leavePeriod)
            ? formVM.leavePeriod
            : '';

        var html = '';
        html += '<form id="edit-member-form" ' +
                    'data-character-id="' + escapeAttribute(formVM.characterId) + '" ' +
                    'data-join-period="' + escapeAttribute(formVM.joinPeriod || '') + '">';

        html += '<div class="form-group">';
        html += '<label>Character</label>';
        html += '<p style="margin:4px 0 12px 0;font-weight:600;">' +
                    escapeHtml(formVM.characterName || 'Unknown') +
                '</p>';
        html += '</div>';

        html += '<div class="form-group">';
        html += '<label for="edit-member-role">Role</label>';
        html += '<input type="text" id="edit-member-role" value="' +
                    escapeAttribute(formVM.role || '') + '">';
        html += '<p class="field-hint">Applies to the whole member, not just this stint.</p>';
        html += '</div>';

        html += '<div class="form-group">';
        html += '<label>Join Period</label>';
        html += '<input type="text" value="' +
                    escapeAttribute(joinDisplay) +
                '" readonly disabled>';
        html += '<p class="field-hint">' +
                    'Join is immutable. To move a start week, remove this stint and add a new one.' +
                '</p>';
        html += '</div>';

        html += '<div class="form-group">';
        html += '<label for="edit-member-leave">Leave Period</label>';
        html += '<input type="text" id="edit-member-leave" value="' +
                    escapeAttribute(leaveValue) + '">';
        html += '<p class="field-hint">' +
                    'Blank means the stint is ongoing.' +
                '</p>';
        html += '</div>';

        html += '<div class="form-actions">';
        html += '<button type="button" id="cancel-edit-member" class="secondary">Cancel</button>';
        html += '<button type="submit" id="save-edit-member" class="primary">Save Changes</button>';
        html += '</div>';

        html += '</form>';

        return html;
    }

    // ============================================================
    // RANKING FORM
    // ============================================================

    function renderRankingForm() {
        var html = '';
        html += '<form id="ranking-form-inner">';
        html += '<div class="ranking-form" ' +
                    'style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px;align-items:center;">';
        html += '<input type="text" id="ranking-period" placeholder="Period" ' +
                    'style="flex:1;min-width:100px;padding:6px;background:var(--panel-alt);border:1px solid var(--border);color:var(--text);border-radius:6px;">';
        html += '<input type="number" id="ranking-rank" placeholder="Rank" min="1" ' +
                    'style="flex:1;min-width:80px;padding:6px;background:var(--panel-alt);border:1px solid var(--border);color:var(--text);border-radius:6px;">';
        html += '<button type="button" id="add-ranking-btn" class="primary small">Add Ranking</button>';
        html += '</div>';
        html += '</form>';
        return html;
    }

    // ============================================================
    // CONTAINER
    // ============================================================

    function renderContainer(pageVM) {
        if (!pageVM) {
            throw new Error('[TeamRender] renderContainer requires a page view model.');
        }

        var activeTab = pageVM.activeTab || 'professional';
        var counts = pageVM.counts || {
            professional: 0,
            temporary: 0,
            civilian: 0
        };
        var teams = pageVM.teams || [];
        var expandedTeamId = pageVM.expandedTeamId || null;
        var expandedTeam = pageVM.expandedTeam || null;
        var period = pageVM.period;

        var html = '';

        html += '<div class="page-header">';
        html += '<h2>Team Manager</h2>';
        html += '<button id="add-team-btn" class="primary" type="button">+ Add Team</button>';
        html += '</div>';

        html += '<div class="stats-grid">';
        html += '<div class="stat-card"><h3>Professional</h3><p class="stat-number">' +
                    safeString(counts.professional) +
                '</p></div>';
        html += '<div class="stat-card"><h3>Temporary</h3><p class="stat-number">' +
                    safeString(counts.temporary) +
                '</p></div>';
        html += '<div class="stat-card"><h3>Civilian</h3><p class="stat-number">' +
                    safeString(counts.civilian) +
                '</p></div>';
        html += '</div>';

        html += '<div class="tab-nav" id="team-tab-nav">';
        html += '<button class="tab-btn' + (activeTab === 'professional' ? ' active' : '') + '" ' +
                    'type="button" data-tab="professional">Professional (' +
                    safeString(counts.professional) +
                ')</button>';
        html += '<button class="tab-btn' + (activeTab === 'temporary' ? ' active' : '') + '" ' +
                    'type="button" data-tab="temporary">Temporary (' +
                    safeString(counts.temporary) +
                ')</button>';
        html += '<button class="tab-btn' + (activeTab === 'civilian' ? ' active' : '') + '" ' +
                    'type="button" data-tab="civilian">Civilian (' +
                    safeString(counts.civilian) +
                ')</button>';
        html += '</div>';

        html += '<div id="filter-container" class="filter-container"></div>';

        html += '<div id="team-list-container" class="team-list-container">';

        var expandedMembersVM = null;
        if (expandedTeam && Array.isArray(expandedTeam.members)) {
            expandedMembersVM = {
                teamId: expandedTeam.id,
                periodLabel: expandedTeam.periodLabel || 'Period',
                period: period,
                members: expandedTeam.members
            };
        }

        html += renderList(
            { teams: teams, total: teams.length, filtered: teams.length },
            activeTab,
            expandedTeamId,
            expandedMembersVM
        );

        html += '</div>';

        html += getModalsHTML();

        return html;
    }

    // ============================================================
    // MODALS (static shells)
    // ============================================================

    function getModalsHTML() {
        return [
            '<!-- Team Form Modal -->',
            '<div id="team-form-modal" class="modal hidden">',
                '<div class="modal-content">',
                    '<div class="modal-header">',
                        '<h3 id="team-form-title">Add Team</h3>',
                        '<button class="close-modal" id="close-team-form">&times;</button>',
                    '</div>',
                    '<div class="modal-body" id="team-form-body"></div>',
                '</div>',
            '</div>',

            '<!-- Member Modal (compact) -->',
            '<div id="member-modal" class="modal hidden">',
                '<div class="modal-content">',
                    '<div class="modal-header">',
                        '<h3 id="modal-team-name">Team Members</h3>',
                        '<button class="close-modal">&times;</button>',
                    '</div>',
                    '<div class="modal-body">',
                        '<div class="member-form" style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px;align-items:center;">',
                            '<select id="member-character" style="flex:1;min-width:150px;padding:6px;background:var(--panel-alt);border:1px solid var(--border);color:var(--text);border-radius:6px;">',
                                '<option value="">Select character...</option>',
                            '</select>',
                            '<input type="text" id="member-role" placeholder="Role" style="flex:1;min-width:80px;padding:6px;background:var(--panel-alt);border:1px solid var(--border);color:var(--text);border-radius:6px;">',
                            '<input type="text" id="member-join" placeholder="Join" style="flex:1;min-width:80px;padding:6px;background:var(--panel-alt);border:1px solid var(--border);color:var(--text);border-radius:6px;">',
                            '<input type="text" id="member-leave" placeholder="Leave" style="flex:1;min-width:80px;padding:6px;background:var(--panel-alt);border:1px solid var(--border);color:var(--text);border-radius:6px;">',
                            '<button id="add-member-btn" class="primary small" type="button">Add Member</button>',
                        '</div>',
                        '<div id="members-list">',
                            '<p class="empty-state">No members in this team</p>',
                        '</div>',
                    '</div>',
                '</div>',
            '</div>',

            '<!-- Ranking Modal -->',
            '<div id="ranking-modal" class="modal hidden">',
                '<div class="modal-content">',
                    '<div class="modal-header">',
                        '<h3 id="ranking-modal-title">Ranking History</h3>',
                        '<button class="close-modal">&times;</button>',
                    '</div>',
                    '<div class="modal-body">',
                        '<div id="ranking-form-container"></div>',
                        '<div id="ranking-list">',
                            '<p class="empty-state">No ranking history</p>',
                        '</div>',
                    '</div>',
                '</div>',
            '</div>'
        ].join('');
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.TeamRender = {
        // Container
        renderContainer: renderContainer,

        // Lists / detail
        renderList: renderList,
        renderExpandedMembers: renderExpandedMembers,
        renderTeamCard: renderTeamCard,
        renderTeamSummary: renderTeamSummary,

        // Filter bar
        renderFilterBar: renderFilterBar,

        // Modal contents
        renderMemberList: renderMemberList,
        renderRankingList: renderRankingList,
        renderTeamForm: renderTeamForm,
        renderMemberForm: renderMemberForm,
        renderRankingForm: renderRankingForm,
        renderNameHistoryRow: renderNameHistoryRow,

        // Static modal shells
        getModalsHTML: getModalsHTML,

        // Helpers
        escapeHtml: escapeHtml,
        escapeAttribute: escapeAttribute
    };

    // ============================================================
    // VERIFICATION
    // ============================================================

    (function verify() {
        var exports = window.TeamRender;
        var missing = [];

        var required = [
            'renderContainer',
            'renderList', 'renderExpandedMembers', 'renderTeamCard', 'renderTeamSummary',
            'renderFilterBar',
            'renderMemberList', 'renderRankingList',
            'renderTeamForm', 'renderMemberForm', 'renderRankingForm',
            'renderNameHistoryRow',
            'getModalsHTML',
            'escapeHtml', 'escapeAttribute'
        ];

        for (var i = 0; i < required.length; i++) {
            if (typeof exports[required[i]] !== 'function') {
                missing.push(required[i]);
            }
        }

        if (missing.length > 0) {
            console.warn('[TeamRender] Verification - some exports may be missing:', missing.join(', '));
        }
    })();

})();
