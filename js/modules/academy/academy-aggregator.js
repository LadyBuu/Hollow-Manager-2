// ============================================================
// WEEKLY TEAMS VIEW MODEL
// ============================================================
//
// Moved from academy-view.js. Owns the construction of the Weekly
// Teams view model: team list rows, team detail, member rows.
//
// The view (AcademyWeeklyTeamsView) expects this exact shape. The
// view does not reach into TeamQueries directly.

/**
 * Build the full Weekly Teams view model for a class + week.
 *
 * @param {string|null} classId - Currently selected class, or null
 * @param {number} week - Week number
 * @param {string|null} selectedTeamId - Currently expanded team, or null
 * @returns {object} { classList, classId, className, week, teams,
 *                     selectedTeamId, selectedTeam }
 */
function getWeeklyTeamsViewViewModel(classId, week, selectedTeamId) {
    // ---- Class list ----
    var classes = AcademyQueries.getClasses() || [];
    classes = classes.slice().sort(function(a, b) {
        return (a.name || '').localeCompare(b.name || '');
    });

    var classListVM = classes.map(function(c) {
        return { id: c.id, name: c.name };
    });

    // ---- Resolve selected class ----
    var selectedClass = null;
    if (classId) {
        for (var i = 0; i < classes.length; i++) {
            if (String(classes[i].id) === String(classId)) {
                selectedClass = classes[i];
                break;
            }
        }
    }

    if (!selectedClass) {
        return {
            classList: classListVM,
            classId: null,
            className: null,
            week: week,
            teams: [],
            selectedTeamId: null,
            selectedTeam: null
        };
    }

    // ---- Teams list ----
    var teams = buildWeeklyTeamsList(selectedClass, week);

    // ---- Selected team detail ----
    var selectedTeamVM = null;
    var resolvedSelectedTeamId = null;
    if (selectedTeamId) {
        for (var j = 0; j < teams.length; j++) {
            if (String(teams[j].id) === String(selectedTeamId)) {
                selectedTeamVM = buildWeeklyTeamDetail(teams[j]._team, week);
                resolvedSelectedTeamId = teams[j].id;
                break;
            }
        }
    }

    var teamsVM = teams.map(function(t) {
        return {
            id: t.id,
            name: t.name,
            type: t.type,
            typeLabel: t.typeLabel,
            periodLabel: t.periodLabel,
            periodDisplay: t.periodDisplay,
            memberCount: t.memberCount,
            activeMemberCount: t.activeMemberCount,
            status: t.status
        };
    });

    return {
        classList: classListVM,
        classId: selectedClass.id,
        className: selectedClass.name,
        week: week,
        teams: teamsVM,
        selectedTeamId: resolvedSelectedTeamId,
        selectedTeam: selectedTeamVM
    };
}

/**
 * Build the weekly teams list for a class.
 * Internal: consumed by getWeeklyTeamsViewViewModel. Exposed for tests.
 */
function buildWeeklyTeamsList(classRecord, week) {
    var TeamQ = window.TeamQueries;
    if (!TeamQ || typeof TeamQ.getTeamsByClass !== 'function') {
        return [];
    }

    var raw = TeamQ.getTeamsByClass(classRecord.id) || [];
    if (!Array.isArray(raw)) { return []; }

    var items = [];

    for (var i = 0; i < raw.length; i++) {
        var team = raw[i];
        if (!team || !team.id) { continue; }
        if (team.type !== 'academic') { continue; }

        var activeMembers = buildTeamMembersVM(team, week).filter(function(m) {
            return m.activeAtPeriod;
        });

        items.push({
            id: team.id,
            name: team.name || 'Unnamed Team',
            type: team.type,
            typeLabel: getTeamTypeLabel(team.type),
            periodLabel: getTeamPeriodLabel(team.type),
            periodDisplay: getTeamPeriodDisplay(team),
            memberCount: Array.isArray(team.members) ? team.members.length : 0,
            activeMemberCount: activeMembers.length,
            status: team.status || 'active',
            temporaryMission: team.temporaryMission || null,
            _team: team
        });
    }

    items.sort(function(a, b) {
        return (a.name || '').localeCompare(b.name || '');
    });

    return items;
}

function buildWeeklyTeamDetail(team, week) {
    if (!team) { return null; }

    var members = buildTeamMembersVM(team, week);

    return {
        id: team.id,
        name: team.name || 'Unnamed Team',
        type: team.type,
        typeLabel: getTeamTypeLabel(team.type),
        periodLabel: getTeamPeriodLabel(team.type),
        periodDisplay: getTeamPeriodDisplay(team),
        status: team.status || 'active',
        temporaryMission: team.temporaryMission || null,
        members: members,
        activeMemberCount: members.filter(function(m) {
            return m.activeAtPeriod;
        }).length
    };
}

function buildTeamMembersVM(team, week) {
    if (!team || !Array.isArray(team.members)) { return []; }

    var periodNum = parseInt(week, 10);
    if (isNaN(periodNum) || periodNum < 1) { periodNum = 1; }

    var result = [];

    for (var i = 0; i < team.members.length; i++) {
        var member = team.members[i];
        if (!member || !member.characterId) { continue; }

        var char = CharacterQueries.getCharacterById(member.characterId);
        var name = char ? CharacterQueries.getDisplayName(char) : 'Unknown';
        var status = char ? CharacterQueries.getCurrentStatus(char) : '';
        var age = char ? CharacterQueries.getCharacterAge(char) : '';
        var deceased = char ? (char.deceased === true) : false;

        var joinNum = parseInt(member.joinPeriod, 10);
        var leaveNum = parseInt(member.leavePeriod, 10);
        var hasJoin = member.joinPeriod !== undefined &&
            member.joinPeriod !== null && member.joinPeriod !== '';
        var hasLeave = member.leavePeriod !== undefined &&
            member.leavePeriod !== null && member.leavePeriod !== '';
        var joined = !hasJoin || (!isNaN(joinNum) && joinNum <= periodNum);
        var notLeft = !hasLeave || (!isNaN(leaveNum) && leaveNum >= periodNum);
        var activeAtPeriod = joined && notLeft;

        result.push({
            characterId: member.characterId,
            name: name,
            status: status,
            age: age,
            deceased: deceased,
            role: member.role || 'Member',
            joinPeriod: member.joinPeriod || '',
            leavePeriod: member.leavePeriod || '',
            activeAtPeriod: activeAtPeriod
        });
    }

    result.sort(function(a, b) {
        if (a.activeAtPeriod && !b.activeAtPeriod) { return -1; }
        if (!a.activeAtPeriod && b.activeAtPeriod) { return 1; }
        return a.name.localeCompare(b.name);
    });

    return result;
}

function getTeamTypeLabel(type) {
    if (window.TeamConstants &&
        typeof window.TeamConstants.getTypeLabel === 'function') {
        return window.TeamConstants.getTypeLabel(type);
    }
    if (type === 'academic') { return 'Academic'; }
    if (type === 'professional') { return 'Professional'; }
    if (type === 'temporary') { return 'Temporary'; }
    if (type === 'civilian') { return 'Civilian'; }
    return 'Team';
}

function getTeamPeriodLabel(type) {
    if (window.TeamConstants &&
        typeof window.TeamConstants.getPeriodLabel === 'function') {
        return window.TeamConstants.getPeriodLabel(type);
    }
    if (type === 'academic') { return 'Week'; }
    return 'Year';
}

function getTeamPeriodDisplay(team) {
    if (window.TeamQueries &&
        typeof window.TeamQueries.getTeamPeriodDisplay === 'function') {
        return window.TeamQueries.getTeamPeriodDisplay(team);
    }
    return '';
}

// ============================================================
// LOCATION VIEW MODEL
// ============================================================
//
// Moved from academy-view.js. The Location view renderer
// (AcademyLocationView) expects this exact shape. The list VM and
// the schedule VM are both built here.

/**
 * Build the full Location view model for a week.
 *
 * @param {object} filters - { type, search }
 * @param {number} week - Week number
 * @param {string|null} selectedLocationId - Currently selected location
 * @returns {object} { locations, selected, filters, week, scheduleWeek, total }
 */
function getLocationViewViewModel(filters, week, selectedLocationId) {
    filters = filters || {};

    var locations = AcademyQueries.getLocations
        ? AcademyQueries.getLocations()
        : [];

    locations = applyLocationFilters(locations, filters);

    var selected = null;
    if (selectedLocationId) {
        for (var i = 0; i < locations.length; i++) {
            if (String(locations[i].id) === String(selectedLocationId)) {
                selected = buildLocationDetailVM(locations[i], week);
                break;
            }
        }
    }

    var listVM = locations.map(function(l) {
        return buildLocationListRowVM(l, week);
    });

    return {
        locations: listVM,
        selected: selected,
        filters: filters,
        week: week,
        scheduleWeek: week,
        total: listVM.length
    };
}

function applyLocationFilters(locations, filters) {
    var type = filters.type || 'all';
    var search = (filters.search || '').toLowerCase().trim();

    return locations.filter(function(l) {
        if (!l || !l.id) { return false; }
        if (type !== 'all' && l.type !== type) { return false; }
        if (search && (l.name || '').toLowerCase().indexOf(search) === -1) {
            return false;
        }
        return true;
    });
}

function buildLocationListRowVM(l, week) {
    var schedule = getLocationScheduleForWeek(l.id, week);
    return {
        id: l.id,
        name: l.name,
        type: l.type,
        capacity: l.capacity,
        scheduleCount: schedule.length
    };
}

function buildLocationDetailVM(l, week) {
    var schedule = getLocationScheduleForWeek(l.id, week);
    return {
        id: l.id,
        name: l.name,
        type: l.type,
        capacity: l.capacity,
        schedule: schedule
    };
}

function getLocationScheduleForWeek(locationId, week) {
    if (!locationId || !week) { return []; }

    var CQ = window.CalendarQueries;
    if (!CQ || typeof CQ.getLocationSchedule !== 'function') {
        return [];
    }

    var raw = CQ.getLocationSchedule(locationId, week);
    if (!raw || typeof raw !== 'object') { return []; }

    var entries = [];
    var disciplineCache = {};

    for (var dayKey in raw) {
        if (!Object.prototype.hasOwnProperty.call(raw, dayKey)) { continue; }
        var dayNum = parseInt(dayKey, 10);
        if (isNaN(dayNum)) { continue; }
        var daySchedule = raw[dayKey];
        if (!daySchedule || typeof daySchedule !== 'object') { continue; }

        for (var hourKey in daySchedule) {
            if (!Object.prototype.hasOwnProperty.call(daySchedule, hourKey)) {
                continue;
            }
            var hourNum = parseInt(hourKey, 10);
            if (isNaN(hourNum)) { continue; }
            var disciplineId = daySchedule[hourKey];
            if (!disciplineId) { continue; }

            var metadata = null;
            if (typeof CQ.getSlotMetadata === 'function') {
                metadata = CQ.getSlotMetadata(locationId, week, dayNum, hourNum);
            }

            var disciplineName = disciplineCache[disciplineId];
            if (disciplineName === undefined) {
                disciplineName = resolveDisciplineName(disciplineId);
                disciplineCache[disciplineId] = disciplineName;
            }

            entries.push({
                day: dayNum,
                hour: hourNum,
                disciplineId: disciplineId,
                disciplineName: disciplineName,
                duration: metadata && metadata.duration ? metadata.duration : 1,
                label: metadata && metadata.label ? metadata.label : ''
            });
        }
    }

    entries.sort(function(a, b) {
        if (a.day !== b.day) { return a.day - b.day; }
        return a.hour - b.hour;
    });

    return entries;
}

function resolveDisciplineName(disciplineId) {
    var DiscQ = window.DisciplineQueries;
    if (DiscQ && typeof DiscQ.getDiscipline === 'function') {
        var d = DiscQ.getDiscipline(disciplineId);
        if (d && d.name) { return d.name; }
    }
    return 'Unknown';
}

// ============================================================
// RANKING VIEW MODEL
// ============================================================
//
// Moved from academy-view.js. Builds the ranked entries list the
// Ranking view renderer consumes.

/**
 * Build the full Ranking view model for a class + week.
 *
 * @param {string|null} classId - Currently selected class, or null
 * @param {number} week - Week number
 * @returns {object} { classList, classId, className, week, entries, total }
 */
function getRankingViewViewModel(classId, week) {
    // ---- Class list ----
    var classes = AcademyQueries.getClasses() || [];
    classes = classes.slice().sort(function(a, b) {
        return (a.name || '').localeCompare(b.name || '');
    });

    var classListVM = classes.map(function(c) {
        return { id: c.id, name: c.name };
    });

    // ---- Resolve selected class ----
    var selectedClass = null;
    if (classId) {
        for (var i = 0; i < classes.length; i++) {
            if (String(classes[i].id) === String(classId)) {
                selectedClass = classes[i];
                break;
            }
        }
    }

    if (!selectedClass) {
        return {
            classList: classListVM,
            classId: null,
            className: null,
            week: week,
            entries: [],
            total: 0
        };
    }

    var entries = buildRankingEntries(selectedClass, week);

    return {
        classList: classListVM,
        classId: selectedClass.id,
        className: selectedClass.name,
        week: week,
        entries: entries,
        total: entries.length
    };
}

function buildRankingEntries(classRecord, week) {
    if (!AcademyQueries ||
        typeof AcademyQueries.calculateClassRanking !== 'function') {
        return [];
    }

    var raw = AcademyQueries.calculateClassRanking(classRecord.id, week) || [];
    if (!Array.isArray(raw)) { return []; }

    var instructorId = classRecord.instructorId
        ? String(classRecord.instructorId)
        : null;

    var entries = raw.map(function(e) {
        if (!e) { return null; }
        var studentId = e.studentId ? String(e.studentId) : '';
        return {
            studentId: studentId,
            studentName: e.name || e.studentName ||
                getCharacterDisplayName(studentId),
            rank: e.rank,
            average: e.average,
            gradeCount: e.gradeCount || 0,
            isInstructor: instructorId !== null &&
                studentId === instructorId
        };
    }).filter(function(e) { return e !== null; });

    entries.sort(function(a, b) {
        var ra = typeof a.rank === 'number' ? a.rank : 999;
        var rb = typeof b.rank === 'number' ? b.rank : 999;
        return ra - rb;
    });

    return entries;
}

// ============================================================
// DISCIPLINE LIST VIEW MODEL
// ============================================================
//
// Moved from academy-view.js. Builds the discipline list rows the
// Discipline view renderer consumes in its sidebar.
//
// NOTE: The inline discipline editor draft state remains in
// academy-view.js for now. It will be extracted in a follow-up
// pass. This function only builds the list rows.

/**
 * Build the discipline list rows for the Discipline view sidebar.
 *
 * @param {object} filters - { type, search }
 * @returns {object} { disciplines, filters, total }
 */
function getDisciplineListViewModel(filters) {
    filters = filters || {};

    var disciplines = AcademyQueries.getDisciplines
        ? AcademyQueries.getDisciplines()
        : [];

    disciplines = applyDisciplineFilters(disciplines, filters);

    var listVM = disciplines.map(function(d) {
        return buildDisciplineListRowVM(d);
    });

    return {
        disciplines: listVM,
        filters: filters,
        total: listVM.length
    };
}

function applyDisciplineFilters(disciplines, filters) {
    var type = filters.type || 'all';
    var search = (filters.search || '').toLowerCase().trim();

    return disciplines.filter(function(d) {
        if (!d || !d.id) { return false; }
        if (type !== 'all' && d.type !== type) { return false; }
        if (search && (d.name || '').toLowerCase().indexOf(search) === -1) {
            return false;
        }
        return true;
    });
}

function buildDisciplineListRowVM(d) {
    return {
        id: d.id,
        name: d.name,
        type: d.type,
        startWeek: d.startWeek,
        endWeek: d.endWeek,
        weeklyHours: d.weeklyHours,
        weight: d.weight,
        instructorIds: d.instructorIds || [],
        instructorNames: (d.instructorIds || []).map(function(id) {
            return getCharacterDisplayName(id);
        })
    };
}
