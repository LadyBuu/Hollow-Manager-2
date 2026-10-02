/**
 * modules/departments/department-aggregator.js - Department Aggregator
 *
 * Path: js/modules/departments/department-aggregator.js
 *
 * Projection builder for the Departments domain.
 *
 * WHAT THIS OWNS:
 *   - Page VM: list of departments plus the selected detail.
 *   - Department detail VM: header, member rows, head, mentoring.
 *   - Department summary rows for the sidebar.
 *   - Member row VMs with resolved names and status labels.
 *   - Mentorship rows with both parties resolved.
 *
 * WHAT THIS DOES NOT OWN:
 *   - Reads. DepartmentQueries owns them.
 *   - Cross-domain state. Character death and retirement are
 *     read-time facts supplied by DepartmentQueries.
 *   - Rendering. DepartmentRender owns it.
 *
 * VM SHAPE PRINCIPLES:
 *   - Plain data. No functions, no live record references.
 *   - Every row carries display-ready strings for names, dates,
 *     and status labels. Renderers do not format.
 *   - Missing dependencies fail loud. There is no silent
 *     degradation to "0 members" when a module is absent.
 *
 * DEPENDENCIES (MANDATORY):
 *   - window.DepartmentQueries
 *   - window.CharacterQueries
 *   - window.CharacterConstants
 *   - window.SocialQueries
 *
 * DEPENDENCIES (LAZY):
 *   - window.TeamQueries (not used by this module; reserved for a
 *     later revision that surfaces cross-department career
 *     context)
 */

(function() {
    'use strict';

    if (window.__departmentAggregatorLoaded) {
        return;
    }

    // ============================================================
    // MANDATORY DEPENDENCIES
    // ============================================================

    var DepartmentQueries = window.DepartmentQueries;
    var CharacterQueries = window.CharacterQueries;
    var CharacterConstants = window.CharacterConstants;
    var SocialQueries = window.SocialQueries;

    var _missing = [];

    if (!DepartmentQueries) {
        _missing.push('DepartmentQueries (module)');
    } else {
        if (typeof DepartmentQueries.getDepartments !== 'function') {
            _missing.push('DepartmentQueries.getDepartments');
        }
        if (typeof DepartmentQueries.getDepartmentById !== 'function') {
            _missing.push('DepartmentQueries.getDepartmentById');
        }
        if (typeof DepartmentQueries.getActiveMembers !== 'function') {
            _missing.push('DepartmentQueries.getActiveMembers');
        }
        if (typeof DepartmentQueries.getFormerMembers !== 'function') {
            _missing.push('DepartmentQueries.getFormerMembers');
        }
        if (typeof DepartmentQueries.getActiveMentorships !== 'function') {
            _missing.push('DepartmentQueries.getActiveMentorships');
        }
        if (typeof DepartmentQueries.getFormerMentorships !== 'function') {
            _missing.push('DepartmentQueries.getFormerMentorships');
        }
        if (typeof DepartmentQueries.getHead !== 'function') {
            _missing.push('DepartmentQueries.getHead');
        }
    }

    if (!CharacterQueries) {
        _missing.push('CharacterQueries (module)');
    } else {
        if (typeof CharacterQueries.getCharacterById !== 'function') {
            _missing.push('CharacterQueries.getCharacterById');
        }
        if (typeof CharacterQueries.getDisplayName !== 'function') {
            _missing.push('CharacterQueries.getDisplayName');
        }
        if (typeof CharacterQueries.getStatusAtYear !== 'function') {
            _missing.push('CharacterQueries.getStatusAtYear');
        }
        if (typeof CharacterQueries.isDeceased !== 'function') {
            _missing.push('CharacterQueries.isDeceased');
        }
    }

    if (!CharacterConstants) {
        _missing.push('CharacterConstants (module)');
    }
    if (!SocialQueries) {
        _missing.push('SocialQueries (module)');
    }

    if (_missing.length > 0) {
        throw new Error(
            '[DepartmentAggregator] Missing mandatory dependencies: ' +
            _missing.join(', ')
        );
    }

    window.__departmentAggregatorLoaded = true;

    // ============================================================
    // HELPERS
    // ============================================================

    function isNonEmptyString(value) {
        return typeof value === 'string' && value.trim() !== '';
    }

    function safeString(value) {
        return value === undefined || value === null
            ? ''
            : String(value);
    }

    function getCurrentYear() {
        var data = window.data || {};
        if (typeof data.currentYear === 'number' &&
            isFinite(data.currentYear) &&
            data.currentYear > 0) {
            return Math.floor(data.currentYear);
        }
        return new Date().getFullYear();
    }

    function getCharacterDisplayName(charId) {
        if (!isNonEmptyString(charId)) { return 'Unknown'; }
        var char = CharacterQueries.getCharacterById(charId);
        if (!char) { return 'Unknown'; }
        return CharacterQueries.getDisplayName(char) || 'Unknown';
    }

    function formatPeriod(start, end) {
        var hasStart = isNonEmptyString(String(start));
        var hasEnd = isNonEmptyString(String(end));

        if (hasStart && hasEnd) {
            return String(start) + ' \u2013 ' + String(end);
        }
        if (hasStart) {
            return String(start) + ' \u2013';
        }
        if (hasEnd) {
            return '\u2013 ' + String(end);
        }
        return '';
    }

    // ============================================================
    // MEMBER STATUS LABEL
    // ============================================================
    //
    // The label is the display value for a single member row.
    // Priority order:
    //   Deceased    character is deceased at the query year
    //   Retired     character's latest career status is retired
    //   Left YYYY   interval containing year has a leave year
    //               strictly before the query year
    //   Active      interval is open, character alive and not
    //               retired
    //   (blank)     interval starts after the query year; the
    //               member is a future member
    //
    // The row's status label and status class are both computed
    // here. The renderer just emits them.

    function getMemberStatusLabel(memberRow, queryYear) {
        if (memberRow.isDeceased) { return 'Deceased'; }
        if (memberRow.isRetired) { return 'Retired'; }
        if (memberRow.leaveYear !== null &&
            memberRow.leaveYear < queryYear) {
            return 'Left ' + String(memberRow.leaveYear);
        }
        if (memberRow.isActive) { return 'Active'; }
        // Future member at the query year.
        return '';
    }

    function getMemberStatusClass(memberRow) {
        if (memberRow.isDeceased) { return 'dept-status-deceased'; }
        if (memberRow.isRetired) { return 'dept-status-retired'; }
        if (memberRow.leaveYear !== null) {
            return 'dept-status-former';
        }
        if (memberRow.isActive) { return 'dept-status-active'; }
        return 'dept-status-future';
    }

    // ============================================================
    // MEMBER ROW VM
    // ============================================================

    function buildMemberRowVM(member, department, queryYear) {
        if (!member || !isNonEmptyString(member.characterId)) {
            return null;
        }

        var charId = String(member.characterId);
        var char = CharacterQueries.getCharacterById(charId);
        var displayName = char
            ? CharacterQueries.getDisplayName(char)
            : 'Unknown';

        var isDeceased = char
            ? CharacterQueries.isDeceased(char, queryYear) === true
            : false;

        var isRetired = char
            ? isCharacterRetired(char)
            : false;

        var isHead = department && department.headId &&
            String(department.headId) === charId;

        // Determine the interval containing the query year, and
        // whether it is open.
        var interval = findIntervalAtYear(member.intervals, queryYear);
        var isActive = false;
        var leaveYear = null;

        if (interval) {
            var leaveRaw = interval.leavePeriod;
            var hasLeave = leaveRaw !== undefined &&
                           leaveRaw !== null &&
                           String(leaveRaw).trim() !== '';
            if (!hasLeave) {
                isActive = true;
            } else {
                leaveYear = parseInt(leaveRaw, 10);
                if (isNaN(leaveYear)) { leaveYear = null; }
            }
        }

        // A member who is active-per-interval but whose character
        // is deceased or retired is not "active" for display.
        if (isDeceased || isRetired) {
            isActive = false;
        }

        var firstJoin = null;
        if (Array.isArray(member.intervals) &&
            member.intervals.length > 0) {
            var earliest = null;
            for (var i = 0; i < member.intervals.length; i++) {
                var iv = member.intervals[i];
                if (!iv) { continue; }
                var y = parseInt(iv.joinPeriod, 10);
                if (isNaN(y)) { continue; }
                if (earliest === null || y < earliest) {
                    earliest = y;
                }
            }
            firstJoin = earliest;
        }

        var row = {
            characterId: charId,
            displayName: displayName,

            status: char
                ? CharacterQueries.getStatusAtYear(char, queryYear)
                : '',

            isActive: isActive,
            isDeceased: isDeceased,
            isRetired: isRetired,
            isHead: isHead,

            leaveYear: leaveYear,
            firstJoin: firstJoin,
            joinDisplay: firstJoin === null
                ? '\u2014'
                : String(firstJoin),

            intervals: Array.isArray(member.intervals)
                ? member.intervals.slice()
                : []
        };

        row.statusLabel = getMemberStatusLabel(row, queryYear);
        row.statusClass = getMemberStatusClass(row);

        return row;
    }

    function findIntervalAtYear(intervals, queryYear) {
        if (!Array.isArray(intervals)) { return null; }

        for (var i = 0; i < intervals.length; i++) {
            var iv = intervals[i];
            if (!iv || typeof iv !== 'object') { continue; }

            var join = parseInt(iv.joinPeriod, 10);
            if (isNaN(join)) { continue; }
            if (join > queryYear) { continue; }

            var leaveRaw = iv.leavePeriod;
            var hasLeave = leaveRaw !== undefined &&
                           leaveRaw !== null &&
                           String(leaveRaw).trim() !== '';

            if (!hasLeave) { return iv; }

            var leave = parseInt(leaveRaw, 10);
            if (isNaN(leave)) { return iv; }
            if (leave >= queryYear) { return iv; }
        }

        return null;
    }

    function isCharacterRetired(char) {
        if (!char || !Array.isArray(char.careerStatus)) {
            return false;
        }
        var latestKey = '';
        var latestYear = -Infinity;
        var latestIndex = -1;

        for (var i = 0; i < char.careerStatus.length; i++) {
            var entry = char.careerStatus[i];
            if (!entry || typeof entry !== 'object') { continue; }

            var raw = entry.status !== undefined &&
                entry.status !== null
                ? String(entry.status).trim().toLowerCase()
                : '';
            if (raw === '') { continue; }

            var formerIdx = raw.indexOf(' (former)');
            if (formerIdx !== -1) {
                raw = raw.substring(0, formerIdx).trim();
            }

            var year = parseInt(entry.startYear, 10);
            if (isNaN(year)) { year = -Infinity; }

            if (year > latestYear ||
                (year === latestYear && i > latestIndex)) {
                latestKey = raw;
                latestYear = year;
                latestIndex = i;
            }
        }

        return latestKey === 'retired';
    }

    // ============================================================
    // MENTORSHIP ROW VM
    // ============================================================

    function buildMentorshipRowVM(rel) {
        if (!rel || typeof rel !== 'object') { return null; }

        var mentorId = String(rel.character1);
        var apprenticeId = String(rel.character2);

        var mentorName = getCharacterDisplayName(mentorId);
        var apprenticeName = getCharacterDisplayName(apprenticeId);

        var startYear = isNonEmptyString(String(rel.startYear))
            ? String(rel.startYear)
            : '';
        var endYear = isNonEmptyString(String(rel.endYear))
            ? String(rel.endYear)
            : '';

        var periodDisplay;
        if (startYear && endYear) {
            periodDisplay = startYear + ' \u2013 ' + endYear;
        } else if (startYear) {
            periodDisplay = startYear + ' \u2013';
        } else if (endYear) {
            periodDisplay = '\u2013 ' + endYear;
        } else {
            periodDisplay = '';
        }

        return {
            id: rel.id,
            mentorId: mentorId,
            apprenticeId: apprenticeId,
            mentorName: mentorName,
            apprenticeName: apprenticeName,
            startYear: startYear,
            endYear: endYear,
            periodDisplay: periodDisplay,
            notes: typeof rel.notes === 'string' ? rel.notes : ''
        };
    }

    function buildMentorshipRows(rels) {
        if (!Array.isArray(rels) || rels.length === 0) {
            return [];
        }

        var rows = [];
        for (var i = 0; i < rels.length; i++) {
            var vm = buildMentorshipRowVM(rels[i]);
            if (vm) { rows.push(vm); }
        }

        rows.sort(function(a, b) {
            return a.mentorName.localeCompare(b.mentorName);
        });

        return rows;
    }

    // ============================================================
    // DEPARTMENT DETAIL VM
    // ============================================================

    function getDepartmentDetailViewModel(deptId, options) {
        options = options || {};

        var queryYear = options.year !== undefined &&
            options.year !== null
            ? parseInt(options.year, 10)
            : getCurrentYear();
        if (isNaN(queryYear) || queryYear < 1) {
            queryYear = getCurrentYear();
        }

        var department = DepartmentQueries.getDepartmentById(deptId);
        if (!department) { return null; }

        // ---- Head ----
        var headVM = null;
        var head = DepartmentQueries.getHead(department);
        if (head) {
            headVM = {
                characterId: head.characterId,
                displayName: head.displayName
            };
        }

        // ---- Members ----
        var activeMembers = DepartmentQueries.getActiveMembers(
            department, queryYear
        );
        var formerMembers = DepartmentQueries.getFormerMembers(
            department, queryYear
        );

        var activeRows = [];
        for (var i = 0; i < activeMembers.length; i++) {
            var row = buildMemberRowVM(
                activeMembers[i], department, queryYear
            );
            if (row) { activeRows.push(row); }
        }
        activeRows.sort(function(a, b) {
            return a.displayName.localeCompare(b.displayName);
        });

        var formerRows = [];
        for (var j = 0; j < formerMembers.length; j++) {
            var rowF = buildMemberRowVM(
                formerMembers[j], department, queryYear
            );
            if (rowF) { formerRows.push(rowF); }
        }
        formerRows.sort(function(a, b) {
            return a.displayName.localeCompare(b.displayName);
        });

        // ---- Mentorships ----
        var activeMentorships =
            DepartmentQueries.getActiveMentorships(
                department, queryYear
            );
        var formerMentorships =
            DepartmentQueries.getFormerMentorships(
                department, queryYear
            );

        var activeMentorRows = buildMentorshipRows(
            activeMentorships
        );
        var formerMentorRows = buildMentorshipRows(
            formerMentorships
        );

        return {
            year: queryYear,

            department: {
                id: department.id,
                name: department.name,
                description: department.description || ''
            },

            head: headVM,

            summary: {
                activeCount: activeRows.length,
                formerCount: formerRows.length,
                activeMentorshipCount: activeMentorRows.length,
                formerMentorshipCount: formerMentorRows.length
            },

            members: {
                active: activeRows,
                former: formerRows
            },

            mentorships: {
                active: activeMentorRows,
                former: formerMentorRows
            }
        };
    }

    // ============================================================
    // DEPARTMENT SUMMARY ROW
    // ============================================================

    function buildDepartmentSummaryVM(department, queryYear) {
        var head = DepartmentQueries.getHead(department);
        var headDisplay = head ? head.displayName : '';

        var activeCount = DepartmentQueries.getActiveMembers(
            department, queryYear
        ).length;

        return {
            id: department.id,
            name: department.name || 'Unnamed Department',
            headDisplay: headDisplay,
            activeCount: activeCount
        };
    }

    // ============================================================
    // PAGE VM
    // ============================================================

    function getDepartmentPageViewModel(options) {
        options = options || {};

        var queryYear = options.year !== undefined &&
            options.year !== null
            ? parseInt(options.year, 10)
            : getCurrentYear();
        if (isNaN(queryYear) || queryYear < 1) {
            queryYear = getCurrentYear();
        }

        var selectedDeptId = options.selectedDeptId || null;

        var allDepartments = DepartmentQueries.getDepartments();
        var summaries = [];

        for (var i = 0; i < allDepartments.length; i++) {
            summaries.push(buildDepartmentSummaryVM(
                allDepartments[i], queryYear
            ));
        }

        // If no selection, or the selection no longer exists,
        // fall back to the first department (or null when there
        // are none).
        var resolvedSelectedId = null;
        if (selectedDeptId) {
            for (var k = 0; k < summaries.length; k++) {
                if (String(summaries[k].id) === String(selectedDeptId)) {
                    resolvedSelectedId = summaries[k].id;
                    break;
                }
            }
        }
        if (resolvedSelectedId === null && summaries.length > 0) {
            resolvedSelectedId = summaries[0].id;
        }

        var detailVM = resolvedSelectedId
            ? getDepartmentDetailViewModel(resolvedSelectedId, {
                year: queryYear
            })
            : null;

        return {
            year: queryYear,
            summaries: summaries,
            selectedDeptId: resolvedSelectedId,
            detail: detailVM,
            counts: {
                total: summaries.length
            }
        };
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.DepartmentAggregator = Object.freeze({
        getDepartmentPageViewModel: getDepartmentPageViewModel,
        getDepartmentDetailViewModel: getDepartmentDetailViewModel,
        getDepartmentSummaryViewModel: buildDepartmentSummaryVM
    });

    // ============================================================
    // VERIFICATION
    // ============================================================

    (function verify() {
        var exports = window.DepartmentAggregator;
        var missing = [];

        var required = [
            'getDepartmentPageViewModel',
            'getDepartmentDetailViewModel',
            'getDepartmentSummaryViewModel'
        ];

        for (var i = 0; i < required.length; i++) {
            if (typeof exports[required[i]] !== 'function') {
                missing.push(required[i]);
            }
        }

        if (missing.length > 0) {
            console.warn(
                '[DepartmentAggregator] Verification failed:',
                missing.join(', ')
            );
        }
    })();

})();
