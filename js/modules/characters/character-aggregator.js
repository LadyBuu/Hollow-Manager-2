/**
 * modules/characters/character-aggregator.js - Character Aggregator
 * Character's integration boundary with external domains.
 *
 * Path: js/modules/characters/character-aggregator.js
 *
 * RESPONSIBILITIES:
 *   - Build character projections by composing shared queries and
 *     domain modules.
 *   - Return display-ready view models.
 *   - Never mutate. Never touch persistence. No UI dependencies.
 *
 * PROJECTIONS:
 *   - getCharacterDetail(id, options)
 *   - getCharacterListViewModel(options)
 *   - getCharacterAcademicData(id, week, options)
 *   - getCharacterProfessionalData(id)
 *   - getCharacterSocialData(id)
 *
 * ENTITY ESCAPE:
 *   getCharacterDetail returns `character: char` — the live record
 *   — because CharacterDetail reads it directly for the raw bio
 *   fields, and because re-projecting every scalar would duplicate
 *   the record without adding safety. It also returns the raw
 *   `careerStatus` array. The projection cannot therefore be frozen
 *   or cached; callers must treat the record as read-only. This is
 *   a deliberate trade-off for a view layer; do not rely on the
 *   projection being isolated from the store.
 *
 * LIST PROJECTION:
 *   - Accepts hideFiller, classFilter (including the __no_class__
 *     sentinel), sort.
 *   - Rows carry age and ageDisplay, plus a year-scoped deceased
 *     and elimination status.
 *   - Filter runs BEFORE the expensive per-character computations
 *     (ages, professional team list). Only survivors pay for those.
 *
 * __no_class__ SEMANTICS (H.1):
 *   The sentinel is owned by character-class-view.js. That module
 *   declares the option list, emits the sentinel in the filter
 *   dropdown, and exports it on window.CharacterClassView
 *   .NO_CLASS_FILTER. This module is a CONSUMER of that value: it
 *   must compare against the same string the dropdown emits.
 *
 *   Reading the sentinel lazily (getNoClassFilter()) makes the two
 *   modules agree at runtime rather than at authoring time. If the
 *   string ever changes, it changes in one place — the owning
 *   module — and this consumer picks up the new value the next
 *   time it runs. A second literal here would silently diverge.
 *
 *   The local '__no_class__' fallback exists only for load-order
 *   safety: a caller can invoke getCharacterListViewModel before
 *   character-class-view.js has loaded (for instance, from an
 *   early characters/index.js init). The fallback is the same
 *   literal the owner uses, so even in that window the comparison
 *   works; the moment the owner loads, the primary path takes
 *   over.
 *
 *   A character matches __no_class__ when classIds is empty, OR
 *   when every entry in classIds fails to resolve against the live
 *   class set. If AcademyClasses is unavailable, the filter
 *   throws — there is no reliable way to check "no real class"
 *   without the live class map.
 *
 * AGE SEMANTICS:
 *   - getCharacterDetail uses CharacterQueries.getCharacterAge(char),
 *     the age as of the current year.
 *   - getCharacterListViewModel uses
 *     CharacterQueries.calculateAge(char, filterYear).
 *
 *   When filterYear === currentYear, the two agree. When a caller
 *   filters by a historical year, they intentionally do not.
 *   resolveFilterYear is the single place the filter year is
 *   derived.
 *
 * DEATH MODEL:
 *   isDeceased(char, year) is the canonical query. char.deceased is
 *   a cached mirror written by CharacterCRUD on save.
 *
 * ELIMINATION SCOPE:
 *   Elimination is year-scoped. The list projection, the detail
 *   projection, and the academic projection all use
 *   EliminationQueries.isCharacterEliminatedByYear(charId, year)
 *   where a year is available. ByWeek is used only as a fallback
 *   when no year is provided.
 *
 *   H.2 — FAIL-CLOSED hideEliminated FILTER:
 *   When hideEliminated is on, the filter MUST be able to run.
 *   If EliminationQueries is missing entirely, or if it is present
 *   but does not export isCharacterEliminatedByYear, the list
 *   projection THROWS. This is the same policy the __no_class__
 *   branch already uses for a missing AcademyClasses. The
 *   alternative — silently returning the unfiltered list — is the
 *   hidden failure the plan calls out: the user unticks a filter
 *   and nothing happens, with no signal about why.
 *
 *   When hideEliminated is OFF, a missing EliminationQueries
 *   degrades to `eliminated: false` on every row. That is a
 *   display limitation, not a correctness failure, and it is
 *   outside the fail-closed scope: the user did not ask for
 *   elimination filtering.
 *
 * TEAM TYPE NORMALISATION:
 *   Every comparison of a team's `type` field in this file routes
 *   through TeamConstants.normalizeTeamType, matching the sweep
 *   applied to team-queries.js, team-core.js, and
 *   character-export.js. A legacy 'temporary' or 'internship'
 *   record matches 'professional' the moment it hits any filter
 *   here.
 *
 *   Because 'temporary' is retired and normalises to
 *   'professional', the `temporaryTeams` list would always be
 *   empty after normalisation. This module therefore does not emit
 *   a `temporaryTeams` key at all. A renderer that reads it gets
 *   `undefined`, which is honest; a permanently-empty array would
 *   look like a working filter that found nothing.
 *
 * TEAM PERIODS:
 *   formatTeams reads member.intervals first (the current shape,
 *   one entry per stint). A member whose intervals array is missing
 *   or empty falls back to the flat joinPeriod / leavePeriod pair
 *   so no stint is silently dropped.
 *
 * SHAPE OWNERSHIP:
 *   This module reads window.data. It does not repair it. Shape
 *   enforcement, migration, and field defaults are owned by
 *   database.js's normaliseDataStructure. If a field is
 *   unexpectedly absent, the fix belongs in the normaliser.
 *
 * LOAD ORDER:
 *   All dependencies are resolved lazily at call time. Every public
 *   projection calls checkDependencies with its own name, so a
 *   missing module produces a single warning naming the projection.
 *
 *   CalendarQueries is NOT in the required list. The schedule block
 *   already guards its use, and a missing module degrades to
 *   scheduleCount = 0 without a warning. The list and detail
 *   projections render correctly with schedule data absent.
 *
 *   TeamConstants is added by the type-normalisation sweep. It is
 *   required for the list and detail projections (they filter
 *   teams by type); a missing module produces a warning, and the
 *   filter falls back to raw type comparison so the projection
 *   still renders. This preserves the pre-sweep behaviour for the
 *   narrow window before team-constants.js loads.
 *
 * DEPENDENCIES (LAZY):
 *   - window.CharacterQueries
 *   - window.AcademyClasses
 *   - window.AcademyGrades
 *   - window.AcademyDisciplines
 *   - window.TeamQueries
 *   - window.TeamConstants       (type normalisation)
 *   - window.SocialQueries
 *   - window.MissionQueries
 *   - window.EliminationQueries
 *   - window.TournamentQueries
 *   - window.CalendarQueries     (optional; schedule only)
 *   - window.CharacterStats
 *   - window.CharacterConstants
 *   - window.CalendarConstants
 *   - window.MagicConstants
 *   - window.CharacterClassView  (optional; NO_CLASS_FILTER sentinel)
 */

(function() {
    'use strict';

    if (window.__characterAggregatorLoaded) {
        return;
    }
    window.__characterAggregatorLoaded = true;

    // ============================================================
    // LAZY DEPENDENCIES
    // ============================================================

    function getCharacterQueries() { return window.CharacterQueries || null; }
    function getAcademyClasses() { return window.AcademyClasses || null; }
    function getAcademyGrades() { return window.AcademyGrades || null; }
    function getAcademyDisciplines() { return window.AcademyDisciplines || null; }
    function getTeamQueries() { return window.TeamQueries || null; }
    function getTeamConstants() { return window.TeamConstants || null; }
    function getSocialQueries() { return window.SocialQueries || null; }
    function getMissionQueries() { return window.MissionQueries || null; }
    function getEliminationQueries() { return window.EliminationQueries || null; }
    function getTournamentQueries() { return window.TournamentQueries || null; }
    function getCalendarQueries() { return window.CalendarQueries || null; }
    function getCharacterStats() { return window.CharacterStats || null; }
    function getCharacterConstants() { return window.CharacterConstants || null; }
    function getCalendarConstants() { return window.CalendarConstants || null; }
    function getMagicConstants() { return window.MagicConstants || null; }
    function getCharacterClassView() { return window.CharacterClassView || null; }

    // ============================================================
    // SENTINEL: NO_CLASS_FILTER
    // ============================================================
    //
    // The sentinel's owner is character-class-view.js. It declares
    // the option list, emits the sentinel in the filter dropdown,
    // and exports the string on window.CharacterClassView
    // .NO_CLASS_FILTER. This module consumes that value.
    //
    // The fallback literal matches the owner's own default. It
    // exists only to keep the filter working in the narrow window
    // between this module loading and character-class-view.js
    // loading. It is not a second source of truth; it is a
    // last-resort value that agrees with the owner today and will
    // agree with the owner tomorrow as long as nobody edits only
    // one of the two. The way to change the sentinel is to change
    // it in character-class-view.js; this module picks up the new
    // value on the next call.

    var FALLBACK_NO_CLASS_FILTER = '__no_class__';

    function getNoClassFilter() {
        var CCV = getCharacterClassView();
        if (CCV &&
            typeof CCV.NO_CLASS_FILTER === 'string' &&
            CCV.NO_CLASS_FILTER !== '') {
            return CCV.NO_CLASS_FILTER;
        }
        return FALLBACK_NO_CLASS_FILTER;
    }

    // ============================================================
    // TEAM TYPE NORMALISATION
    // ============================================================
    //
    // Every comparison of a team's `type` in this file routes
    // through this helper. When TeamConstants is available (the
    // normal case), the comparison is canonical: a legacy
    // 'temporary' or 'internship' record matches 'professional'.
    //
    // When TeamConstants is missing (a load-order problem that
    // self-heals once team-constants.js loads), the helper falls
    // back to the raw type, so a filter still matches a record
    // whose type already IS the canonical string. The fallback
    // does not reproduce the legacy-alias mapping — a
    // pre-retirement 'temporary' record will not match
    // 'professional' until TeamConstants loads. That is the same
    // failure mode the reader had before this sweep, so the
    // fallback is strictly a non-regression.

    function normaliseTeamTypeForFilter(team) {
        if (!team || typeof team !== 'object') { return ''; }
        var TC = getTeamConstants();
        if (!TC || typeof TC.normalizeTeamType !== 'function') {
            return typeof team.type === 'string' ? team.type : '';
        }
        return TC.normalizeTeamType(team.type) || '';
    }

    // ============================================================
    // DEPENDENCY CHECK - per projection
    // ============================================================
    //
    // CalendarQueries is deliberately absent from the required
    // list. The schedule block already guards its use, so a
    // missing module is a degradation (scheduleCount = 0), not a
    // missing dependency. This removes the "Dependencies not yet
    // loaded: CalendarQueries" warning from every character tab
    // mount when the schedule module loads lazily.
    //
    // CharacterClassView and TeamConstants are also deliberately
    // absent from the required list. Both have lazy fallbacks that
    // preserve behaviour until they load. Requiring them here
    // would produce a warning on every tab mount in the narrow
    // window before those modules load, for no behavioural gain.

    function checkDependencies(calleeName) {
        var missing = [];

        if (!getCharacterQueries()) { missing.push('CharacterQueries'); }
        if (!getAcademyClasses()) { missing.push('AcademyClasses'); }
        if (!getAcademyGrades()) { missing.push('AcademyGrades'); }
        if (!getAcademyDisciplines()) { missing.push('AcademyDisciplines'); }
        if (!getTeamQueries()) { missing.push('TeamQueries'); }
        if (!getSocialQueries()) { missing.push('SocialQueries'); }
        if (!getMissionQueries()) { missing.push('MissionQueries'); }
        if (!getEliminationQueries()) { missing.push('EliminationQueries'); }
        if (!getTournamentQueries()) { missing.push('TournamentQueries'); }
        if (!getCharacterStats()) { missing.push('CharacterStats'); }
        if (!getCharacterConstants()) { missing.push('CharacterConstants'); }
        if (!getCalendarConstants()) { missing.push('CalendarConstants'); }

        if (missing.length > 0) {
            console.warn(
                '[CharacterAggregator] ' + calleeName +
                ' — dependencies not yet loaded:',
                missing.join(', ')
            );
            return false;
        }

        return true;
    }

    // ============================================================
    // CONSTANTS
    // ============================================================

    var VALID_SORTS = {
        'name-asc': true,
        'name-desc': true,
        'age-asc': true,
        'age-desc': true
    };

    var DEFAULT_SORT = 'name-asc';

    // ============================================================
    // HELPERS
    // ============================================================

    function getCurrentWeek() {
        var CQ = getCharacterQueries();
        if (CQ && typeof CQ.getCurrentWeek === 'function') {
            return CQ.getCurrentWeek();
        }
        var data = window.data || {};
        var CC = getCalendarConstants();
        var week = data.currentWeek;
        var minWeek = CC ? CC.MIN_WEEK || 1 : 1;
        var maxWeek = CC ? CC.MAX_WEEK || 52 : 52;
        if (typeof week === 'number' &&
            week >= minWeek && week <= maxWeek) {
            return week;
        }
        return 1;
    }

    function resolveFilterYear(options) {
        if (options &&
            options.year !== undefined &&
            options.year !== null) {
            var explicit = parseInt(options.year, 10);
            if (!isNaN(explicit) && explicit >= 1) {
                return explicit;
            }
        }

        var CQ = getCharacterQueries();
        if (CQ && typeof CQ.getCurrentYear === 'function') {
            var y = CQ.getCurrentYear();
            if (typeof y === 'number' && isFinite(y) && y > 0) {
                return Math.floor(y);
            }
        }

        var data = window.data || {};
        if (typeof data.currentYear === 'number' &&
            isFinite(data.currentYear) &&
            data.currentYear > 0) {
            return Math.floor(data.currentYear);
        }

        return new Date().getFullYear();
    }

    function isDeceased(char, year) {
        var CQ = getCharacterQueries();
        if (CQ && typeof CQ.isDeceased === 'function') {
            return CQ.isDeceased(char, year);
        }
        return char && char.deceased === true;
    }

    function getModifier(value) {
        var num = Number(value);
        if (isNaN(num) || !isFinite(num)) { return 0; }
        return Math.floor((num - 10) / 2);
    }

    function getModifierDisplay(value) {
        var mod = getModifier(value);
        return (mod >= 0 ? '+' : '') + mod;
    }

    // ---- Magic level helpers delegate to MagicConstants ----

    var MAGIC_LEVEL_COLOUR = {
        master:     'var(--danger)',
        expert:     'var(--warning)',
        adept:      'var(--accent)',
        apprentice: 'var(--info)',
        novice:     'var(--text-dim)',
        untrained:  'var(--border)'
    };

    function getMagicLevelLabel(score) {
        var MC = getMagicConstants();
        if (MC && typeof MC.getProficiencyLevelLabel === 'function') {
            return MC.getProficiencyLevelLabel(score);
        }
        // Fallback: mirrors MagicConstants thresholds.
        var num = Number(score);
        if (isNaN(num) || !isFinite(num)) { return 'Untrained'; }
        if (num >= 9) { return 'Master'; }
        if (num >= 7) { return 'Expert'; }
        if (num >= 5) { return 'Adept'; }
        if (num >= 3) { return 'Apprentice'; }
        if (num >= 1) { return 'Novice'; }
        return 'Untrained';
    }

    function getMagicLevelColor(score) {
        var MC = getMagicConstants();
        if (MC && typeof MC.getProficiencyLevel === 'function') {
            var level = MC.getProficiencyLevel(score);
            if (level && level.id) {
                return MAGIC_LEVEL_COLOUR[level.id] || 'var(--border)';
            }
        }
        // Fallback: mirrors MagicConstants thresholds.
        var num = Number(score);
        if (isNaN(num) || !isFinite(num)) { return 'var(--border)'; }
        if (num >= 9) { return 'var(--danger)'; }
        if (num >= 7) { return 'var(--warning)'; }
        if (num >= 5) { return 'var(--accent)'; }
        if (num >= 3) { return 'var(--info)'; }
        if (num >= 1) { return 'var(--text-dim)'; }
        return 'var(--border)';
    }

    function getMagicTypeLabel(key) {
        var MC = getMagicConstants();
        if (MC && typeof MC.getTypeLabel === 'function') {
            return MC.getTypeLabel(key);
        }
        return key.charAt(0).toUpperCase() + key.slice(1);
    }

    function getStatKeys() {
        var CC = getCharacterConstants();
        if (CC && Array.isArray(CC.STAT_KEYS)) {
            return CC.STAT_KEYS;
        }
        return ['str', 'dex', 'con', 'int', 'wis', 'cha'];
    }

    function getStatDefault() {
        var CC = getCharacterConstants();
        if (CC && typeof CC.STAT_DEFAULT === 'number') {
            return CC.STAT_DEFAULT;
        }
        return 10;
    }

    function formatPeriod(join, leave, prefix) {
        prefix = prefix || '';
        var joinStr = (join !== undefined && join !== null && join !== '')
            ? String(join) : '';
        var leaveStr = (leave !== undefined && leave !== null && leave !== '')
            ? String(leave) : '';

        if (joinStr && leaveStr) {
            return prefix + joinStr + ' \u2013 ' + prefix + leaveStr;
        }
        if (joinStr) { return prefix + joinStr + ' \u2013 Present'; }
        if (leaveStr) { return 'Until ' + prefix + leaveStr; }
        return prefix + '?';
    }

    /**
     * Format teams. One row per interval. Falls back to the flat
     * joinPeriod / leavePeriod pair when intervals is missing.
     */
    function formatTeams(teams, charId, prefix) {
        prefix = prefix || '';
        var TeamQueries = getTeamQueries();
        var AcademyClasses = getAcademyClasses();
        var CQ = getCharacterQueries();

        if (!TeamQueries || !CQ) {
            return teams.map(function(team) {
                return {
                    id: team.id,
                    name: team.name || 'Unknown',
                    type: team.type,
                    classId: team.classId,
                    classDisplay: '',
                    role: '',
                    joinPeriod: '',
                    leavePeriod: '',
                    periodDisplay: '',
                    status: team.status || 'active'
                };
            });
        }

        var rows = [];

        teams.forEach(function(team) {
            var member = TeamQueries.getCharacterTeamMembership(
                team.id, charId
            );

            var classDisplay = '';
            if (team.classId && AcademyClasses) {
                var className = AcademyClasses.getDisplayName(
                    team.classId
                );
                if (className && className !== 'Unknown Class') {
                    classDisplay = ' [' + className + ']';
                }
            }

            var intervals = member && Array.isArray(member.intervals)
                ? member.intervals
                : [];

            if (intervals.length === 0 && member) {
                // Legacy flat fields fallback.
                var flatJoin = member.joinPeriod !== undefined &&
                    member.joinPeriod !== null
                    ? String(member.joinPeriod) : '';
                var flatLeave = member.leavePeriod !== undefined &&
                    member.leavePeriod !== null
                    ? String(member.leavePeriod) : '';

                if (flatJoin !== '' || flatLeave !== '') {
                    intervals = [{
                        joinPeriod: flatJoin,
                        leavePeriod: flatLeave
                    }];
                } else {
                    intervals = [{}];
                }
            } else if (intervals.length === 0) {
                intervals = [{}];
            }

            intervals.forEach(function(interval) {
                var join = interval &&
                    interval.joinPeriod !== undefined &&
                    interval.joinPeriod !== null
                    ? String(interval.joinPeriod) : '';
                var leave = interval &&
                    interval.leavePeriod !== undefined &&
                    interval.leavePeriod !== null
                    ? String(interval.leavePeriod) : '';

                rows.push({
                    id: team.id,
                    name: team.name,
                    type: team.type,
                    classId: team.classId,
                    classDisplay: classDisplay,
                    role: member ? member.role : '',
                    joinPeriod: join,
                    leavePeriod: leave,
                    periodDisplay: formatPeriod(join, leave, prefix),
                    status: team.status || 'active'
                });
            });
        });

        return rows;
    }

    function formatGrade(grade) {
        var scoreNum = Number(grade.score);
        var maxNum = Number(grade.maxScore);
        var AcademyDisciplines = getAcademyDisciplines();
        var discipline = null;
        if (AcademyDisciplines &&
            typeof AcademyDisciplines.getDiscipline === 'function') {
            discipline = AcademyDisciplines.getDiscipline(
                grade.disciplineId
            );
        }

        var percentage;
        if (!isNaN(scoreNum) && !isNaN(maxNum) && maxNum > 0) {
            percentage = Math.round((scoreNum / maxNum) * 100);
        } else {
            percentage = null;
        }

        return {
            week: grade.week,
            disciplineId: grade.disciplineId,
            disciplineName: discipline ? discipline.name : 'Unknown',
            score: scoreNum,
            maxScore: maxNum,
            scoreDisplay: percentage !== null
                ? percentage + '%' : 'Invalid',
            percentage: percentage
        };
    }

    function formatElimination(elim, charId) {
        if (!elim) { return null; }

        var TournamentQueries = getTournamentQueries();

        var year = parseInt(elim.year, 10);
        if (isNaN(year) || year < 1) { year = null; }

        var week = parseInt(elim.week, 10);
        if (isNaN(week) || week < 1) { week = null; }

        if (elim.standalone) {
            return {
                id: elim.id,
                year: year,
                week: week,
                reason: elim.reason || '',
                standalone: true
            };
        }

        var tournamentName = 'Unknown Tournament';
        if (elim.tournamentId) {
            if (!TournamentQueries) {
                console.warn(
                    '[CharacterAggregator] TournamentQueries not ' +
                    'loaded — tournament name for elimination "' +
                    elim.id + '" will show as Unknown.'
                );
            } else {
                var tourn = null;
                try {
                    if (typeof TournamentQueries.getTournament ===
                        'function') {
                        tourn = TournamentQueries.getTournament(
                            elim.tournamentId
                        );
                    } else if (typeof TournamentQueries
                        .getTournamentById === 'function') {
                        tourn = TournamentQueries.getTournamentById(
                            elim.tournamentId
                        );
                    }
                } catch (e) {
                    console.warn(
                        '[CharacterAggregator] Tournament lookup ' +
                        'failed:', elim.tournamentId, e
                    );
                    tourn = null;
                }
                if (tourn) {
                    tournamentName = tourn.name ||
                        'Unknown Tournament';
                }
            }
        }

        return {
            id: elim.id,
            tournamentId: elim.tournamentId,
            tournamentName: tournamentName,
            year: year,
            week: week,
            reason: elim.reason || '',
            fromMatch: elim.fromMatch || false,
            standalone: false
        };
    }

    function formatMission(mission) {
        var TeamQueries = getTeamQueries();
        var teamName = (TeamQueries && TeamQueries.getTeamName)
            ? TeamQueries.getTeamName(mission.assignedTeamId)
            : 'Unknown Team';

        return {
            id: mission.id,
            title: mission.title || 'Untitled',
            status: mission.status || 'active',
            location: mission.location || '',
            teamId: mission.assignedTeamId,
            teamName: teamName,
            priority: mission.priority || 'medium',
            progress: mission.progress || 0
        };
    }

    /**
     * Format a relationship. Reads the two-sided clarification
     * fields first, with a legacy fallback to the singular
     * `clarification`.
     */
    function formatRelationship(rel, charId) {
        var CQ = getCharacterQueries();
        var SocialQueries = getSocialQueries();

        if (!CQ || !SocialQueries) {
            return {
                id: rel.id,
                otherId: '',
                otherName: 'Unknown',
                typeId: rel.typeId || '',
                typeLabel: '',
                typeColor: '#7f8c8d',
                clarification: rel.clarification || '',
                clarification1: rel.clarification1 || '',
                clarification2: rel.clarification2 || '',
                startYear: rel.startYear || '',
                endYear: rel.endYear || '',
                period: '',
                notes: rel.notes || ''
            };
        }

        var otherId = String(rel.character1) === String(charId)
            ? rel.character2
            : rel.character1;
        var other = CQ.getCharacterById(otherId);
        var otherName = other
            ? CQ.getDisplayName(other)
            : 'Unknown';

        var typeLabel = SocialQueries.getRelationshipTypeLabel(
            rel.typeId        );
        var typeColor = SocialQueries.getRelationshipTypeColor(
            rel.typeId
        ) || '#7f8c8d';

        var clar1 = rel.clarification1 !== undefined &&
            rel.clarification1 !== null
            ? String(rel.clarification1) : '';
        var clar2 = rel.clarification2 !== undefined &&
            rel.clarification2 !== null
            ? String(rel.clarification2) : '';

        // Legacy fallback: only when neither two-sided field is set.
        var legacyClar = '';
        if (!clar1 && !clar2 && rel.clarification) {
            legacyClar = String(rel.clarification);
        }

        var viewerIsChar1 = String(rel.character1) === String(charId);
        var viewerClar = viewerIsChar1 ? clar1 : clar2;
        var otherClar = viewerIsChar1 ? clar2 : clar1;

        var clarificationDisplay = '';
        if (viewerClar && otherClar &&
            viewerClar.toLowerCase() !== otherClar.toLowerCase()) {
            clarificationDisplay = viewerClar + ' / ' + otherClar;
        } else if (viewerClar) {
            clarificationDisplay = viewerClar;
        } else if (otherClar) {
            clarificationDisplay = otherClar;
        } else if (legacyClar) {
            clarificationDisplay = legacyClar;
        }

        var period = '';
        if (rel.startYear && rel.endYear) {
            period = rel.startYear + ' \u2013 ' + rel.endYear;
        } else if (rel.startYear) {
            period = 'From ' + rel.startYear;
        } else if (rel.endYear) {
            period = 'Until ' + rel.endYear;
        }

        return {
            id: rel.id,
            otherId: otherId,
            otherName: otherName,
            typeId: rel.typeId,
            typeLabel: typeLabel,
            typeColor: typeColor,
            clarification: legacyClar,
            clarification1: clar1,
            clarification2: clar2,
            clarificationDisplay: clarificationDisplay,
            startYear: rel.startYear || '',
            endYear: rel.endYear || '',
            period: period,
            notes: rel.notes || ''
        };
    }

    // ============================================================
    // ACADEMY READS
    // ============================================================

    function academyGetCharacterClasses(char) {
        var AcademyClasses = getAcademyClasses();
        if (!AcademyClasses ||
            typeof AcademyClasses.getCharacterClasses !== 'function') {
            return [];
        }
        return AcademyClasses.getCharacterClasses(char) || [];
    }

    function academyGetCharacterClassNames(char) {
        var AcademyClasses = getAcademyClasses();
        if (!AcademyClasses ||
            typeof AcademyClasses.getCharacterClassNames !==
            'function') {
            return [];
        }
        return AcademyClasses.getCharacterClassNames(char) || [];
    }

    function academyGetStudentGrades(studentId, week) {
        var AcademyGrades = getAcademyGrades();
        if (!AcademyGrades ||
            typeof AcademyGrades.getStudentGrades !== 'function') {
            return [];
        }
        return AcademyGrades.getStudentGrades(studentId, week) || [];
    }

    // ============================================================
    // TEAM READS (LIST)
    // ============================================================

    function getCurrentProfessionalTeamsForList(charId, year) {
        if (!charId) { return []; }

        var TeamQueries = getTeamQueries();
        if (!TeamQueries ||
            typeof TeamQueries.getTeamsForCharacter !== 'function') {
            return [];
        }

        var yearNum = parseInt(year, 10);
        if (isNaN(yearNum) || yearNum < 1) {
            console.warn(
                '[CharacterAggregator] ' +
                'getCurrentProfessionalTeamsForList called with a ' +
                'malformed year "' + year + '" for character ' +
                charId + '. Returning empty list.'
            );
            return [];
        }

        var teams = TeamQueries.getTeamsForCharacter(
            charId, yearNum, 'professional'
        ) || [];

        var result = [];
        for (var i = 0; i < teams.length; i++) {
            var team = teams[i];
            if (!team || !team.id) { continue; }
            if (team.status === 'deprecated') { continue; }
            result.push({
                id: String(team.id),
                name: team.name || 'Unnamed Team'
            });
        }

        result.sort(function(a, b) {
            return a.name.localeCompare(b.name);
        });

        return result;
    }

    // ============================================================
    // TEAM FILTER HELPERS
    // ============================================================
    //
    // The detail and professional-data projections each split a
    // character's team list into per-type buckets. Both used raw
    // `t.type === '...'` comparisons before the Phase F sweep;
    // both route through normaliseTeamTypeForFilter now.
    //
    // The 'temporary' bucket is removed entirely. After
    // normalisation every 'temporary' record becomes
    // 'professional', so a temporary list would always be empty.
    // A renderer reading vm.temporaryTeams gets `undefined`, which
    // is honest about the retirement; an always-empty array would
    // look like a working filter that found nothing.

    function filterTeamsByType(teams, normalisedType) {
        return teams.filter(function(t) {
            return normaliseTeamTypeForFilter(t) === normalisedType;
        });
    }

    // ============================================================
    // CHARACTER DETAIL PROJECTION
    // ============================================================

    function getCharacterDetail(characterId, options) {
        if (!characterId) { return null; }

        checkDependencies('getCharacterDetail');

        var CharacterQueries = getCharacterQueries();
        var TeamQueries = getTeamQueries();
        var SocialQueries = getSocialQueries();
        var MissionQueries = getMissionQueries();
        var EliminationQueries = getEliminationQueries();
        var CharacterStats = getCharacterStats();
        var CalendarQueries = getCalendarQueries();

        if (!CharacterQueries) {
            console.warn(
                '[CharacterAggregator] CharacterQueries unavailable ' +
                'for getCharacterDetail'
            );
            return null;
        }

        options = options || {};
        var weekNum = options.week || getCurrentWeek();
        var filterYear = resolveFilterYear(options);

        var includeSchedule = options.includeSchedule !== false;
        var includeGrades = options.includeGrades !== false;
        var includeRelationships =
            options.includeRelationships !== false;
        var includeMissions = options.includeMissions !== false;
        var includeTeams = options.includeTeams !== false;
        var includeEliminations =
            options.includeEliminations !== false;

        var char = CharacterQueries.getCharacterById(characterId);
        if (!char) { return null; }

        // ---- Character info ----
        var displayName = CharacterQueries.getDisplayName(char);
        var fullName = CharacterQueries.getFullName(char);
        var age = CharacterQueries.getCharacterAge(char);
        var status = CharacterQueries.getCurrentStatus(char);
        var isStudent = CharacterQueries.isStudent(char);
        var isInstructor = CharacterQueries.isInstructor(char);
        var isCivilian = CharacterQueries.isCivilian(char);

        // ---- Death timeline ----
        var deceasedNow = isDeceased(char, filterYear);
        var deathYear = char.deathYear
            ? String(char.deathYear).trim() : '';
        var deathCause = char.deathCause
            ? String(char.deathCause).trim() : '';
        var deathAge = char.deathAge
            ? String(char.deathAge).trim() : '';
        var deathWeek = char.deathWeek
            ? String(char.deathWeek).trim() : '';

        // ---- Stats ----
        var statsWithModifiers = {};
        var statKeys = getStatKeys();
        var statDefault = getStatDefault();

        if (CharacterStats) {
            var stats = CharacterStats.getCharacterStats(char);
            statKeys.forEach(function(key) {
                var value = stats[key] !== undefined
                    ? stats[key] : statDefault;
                statsWithModifiers[key] = {
                    value: value,
                    modifier: getModifier(value),
                    modifierDisplay: getModifierDisplay(value)
                };
            });
        } else {
            statKeys.forEach(function(key) {
                var value = (char.stats &&
                    char.stats[key] !== undefined)
                    ? char.stats[key] : statDefault;
                statsWithModifiers[key] = {
                    value: value,
                    modifier: getModifier(value),
                    modifierDisplay: getModifierDisplay(value)
                };
            });
        }

        // ---- Magic ----
        var magic = {};
        if (CharacterStats) {
            var magicRaw = CharacterStats.getCharacterMagic(char);
            var MC = getMagicConstants();
            var magicTypeKeys = (MC &&
                typeof MC.getTypeKeys === 'function')
                ? MC.getTypeKeys()
                : Object.keys(magicRaw);

            magicTypeKeys.forEach(function(key) {
                var value = magicRaw[key] || 0;
                magic[key] = {
                    value: value,
                    label: getMagicTypeLabel(key),
                    level: getMagicLevelLabel(value),
                    color: getMagicLevelColor(value)
                };
            });
        }

        // ---- Class names ----
        var classNames = academyGetCharacterClassNames(char);

        // ---- Teams ----
        //
        // Type comparisons route through
        // normaliseTeamTypeForFilter. A legacy 'temporary' record
        // matches 'professional' here. The 'temporary' bucket is
        // removed; see filterTeamsByType.
        var academicTeams = [];
        var professionalTeams = [];
        var civilianTeams = [];

        if (includeTeams && TeamQueries) {
            var allTeams = TeamQueries.getTeamsForCharacter(
                characterId
            );
            if (allTeams) {
                academicTeams = formatTeams(
                    filterTeamsByType(allTeams, 'academic'),
                    characterId,
                    'Wk '
                );
                professionalTeams = formatTeams(
                    filterTeamsByType(allTeams, 'professional'),
                    characterId
                );
                civilianTeams = formatTeams(
                    filterTeamsByType(allTeams, 'civilian'),
                    characterId
                );
            }
        }

        // ---- Grades ----
        var grades = [];
        if (includeGrades) {
            var rawGrades = academyGetStudentGrades(characterId);
            grades = rawGrades.map(formatGrade);
            grades.sort(function(a, b) {
                return parseInt(a.week, 10) -
                       parseInt(b.week, 10);
            });
        }

        // ---- Missions ----
        var missions = [];
        if (includeMissions && MissionQueries) {
            var rawMissions =
                MissionQueries.getMissionsForCharacter(
                    characterId
                ) || [];
            missions = rawMissions.map(formatMission);
        }

        // ---- Relationships ----
        var relationships = [];
        if (includeRelationships && SocialQueries) {
            var rawRelationships =
                SocialQueries.getCharacterRelationships(
                    characterId
                ) || [];
            relationships = rawRelationships.map(function(rel) {
                return formatRelationship(rel, characterId);
            });
        }

        // ---- Eliminations (year-scoped) ----
        var tournamentEliminations = [];
        var standaloneEliminations = [];
        var isEliminated = false;
        var eliminationWeek = null;
        var eliminationYear = null;
        var eliminationReason = 'Unknown';

        if (includeEliminations && EliminationQueries) {
            if (typeof EliminationQueries
                .isCharacterEliminatedByYear === 'function') {
                isEliminated = EliminationQueries
                    .isCharacterEliminatedByYear(
                        characterId, filterYear
                    );
            } else if (typeof EliminationQueries
                .isCharacterEliminatedByWeek === 'function') {
                isEliminated = EliminationQueries
                    .isCharacterEliminatedByWeek(
                        characterId, weekNum
                    );
            }

            eliminationWeek =
                (typeof EliminationQueries.getEliminationWeek ===
                    'function')
                ? EliminationQueries.getEliminationWeek(characterId)
                : null;
            eliminationYear =
                (typeof EliminationQueries.getEliminationYear ===
                    'function')
                ? EliminationQueries.getEliminationYear(characterId)
                : null;
            eliminationReason =
                (typeof EliminationQueries.getEliminationReason ===
                    'function')
                ? (EliminationQueries.getEliminationReason(
                    characterId
                ) || 'Unknown')
                : 'Unknown';

            var rawEliminations = char.eliminations || [];
            rawEliminations.forEach(function(elim) {
                var formatted = formatElimination(elim, characterId);
                if (formatted) {
                    if (formatted.standalone) {
                        standaloneEliminations.push(formatted);
                    } else {
                        tournamentEliminations.push(formatted);
                    }
                }
            });
        }

        // ---- Schedule ----
        var scheduleCount = 0;
        if (includeSchedule &&
            CalendarQueries &&
            typeof CalendarQueries.getStudentSchedule ===
            'function') {
            var schedule = CalendarQueries.getStudentSchedule(
                characterId, weekNum
            );
            if (schedule) {
                var count = 0;
                for (var day in schedule) {
                    if (!Object.prototype.hasOwnProperty.call(
                        schedule, day
                    )) {
                        continue;
                    }
                    var daySchedule = schedule[day];
                    if (daySchedule &&
                        typeof daySchedule === 'object') {
                        for (var hour in daySchedule) {
                            if (Object.prototype.hasOwnProperty.call(
                                daySchedule, hour
                            ) && daySchedule[hour]) {
                                count++;
                            }
                        }
                    }
                }
                scheduleCount = count;
            }
        }

        // ---- Career status ----
        var careerStatus = char.careerStatus || [];
        var careerHistory = careerStatus.map(function(statusItem) {
            return {
                status: statusItem.status || 'Unknown',
                startYear: statusItem.startYear || '',
                endYear: statusItem.endYear || '',
                period: formatPeriod(
                    statusItem.startYear, statusItem.endYear
                )
            };
        });

        // ---- Special moves ----
        var specialMoves = { physical: [], magical: [] };
        if (char.specialMoves) {
            if (Array.isArray(char.specialMoves.physical)) {
                specialMoves.physical =
                    char.specialMoves.physical.map(function(m) {
                        return {
                            id: m.id || '',
                            name: m.name || 'Unnamed Move',
                            description: m.description || ''
                        };
                    });
            }
            if (Array.isArray(char.specialMoves.magical)) {
                specialMoves.magical =
                    char.specialMoves.magical.map(function(m) {
                        return {
                            id: m.id || '',
                            name: m.name || 'Unnamed Move',
                            description: m.description || ''
                        };
                    });
            }
        }

        // ---- Personality ----
        var personality = char.personality || {};

        // ---- Classes (actual class objects) ----
        var classes = academyGetCharacterClasses(char);

        // ---- Result ----
        return {
            character: char,
            id: char.id,
            name: displayName,
            fullName: fullName,
            age: age,
            status: status,
            isStudent: isStudent,
            isInstructor: isInstructor,
            isCivilian: isCivilian,

            deceased: deceasedNow,
            deathYear: deathYear,
            deathCause: deathCause,
            deathAge: deathAge,
            deathWeek: deathWeek,

            stats: statsWithModifiers,
            magic: magic,

            classes: classes,
            classNames: classNames,

            academicTeams: academicTeams,
            professionalTeams: professionalTeams,
            civilianTeams: civilianTeams,
            // temporaryTeams: retired. 'temporary' normalises to
            // 'professional' and appears in professionalTeams.

            grades: grades,
            missions: missions,
            relationships: relationships,

            isEliminated: isEliminated,
            eliminationWeek: eliminationWeek,
            eliminationYear: eliminationYear,
            eliminationReason: eliminationReason,
            tournamentEliminations: tournamentEliminations,
            standaloneEliminations: standaloneEliminations,

            scheduleCount: scheduleCount,

            careerStatus: char.careerStatus || [],
            careerHistory: careerHistory,
            specialty: char.specialty || '',

            personality: personality,
            specialMoves: specialMoves,
            notes: char.notes || '',

            week: weekNum,
            year: filterYear
        };
    }

    // ============================================================
    // LIST VIEW MODEL
    // ============================================================

    function getCharacterListViewModel(options) {
        checkDependencies('getCharacterListViewModel');

        var CharacterQueries = getCharacterQueries();
        var AcademyClasses = getAcademyClasses();
        var EliminationQueries = getEliminationQueries();

        if (!CharacterQueries) {
            console.warn(
                '[CharacterAggregator] CharacterQueries unavailable ' +
                'for getCharacterListViewModel'
            );
            return [];
        }

        options = options || {};
        var weekNum = options.week || getCurrentWeek();
        var classFilter = options.classFilter || 'all';
        var nameFilter = options.nameFilter || '';
        var hideDeceased = options.hideDeceased !== false;
        var hideEliminated = options.hideEliminated !== false;
        var hideFiller = options.hideFiller !== false;
        var sortMode = VALID_SORTS[options.sort]
            ? options.sort
            : DEFAULT_SORT;

        var statusFilter = null;
        if (Array.isArray(options.statusFilter) &&
            options.statusFilter.length > 0) {
            statusFilter = options.statusFilter.map(function(s) {
                return String(s).toLowerCase().trim();
            }).filter(function(s) { return s !== ''; });
            if (statusFilter.length === 0) { statusFilter = null; }
        }

        // ---- H.2: fail-closed hideEliminated filter ----
        //
        // The hideEliminated filter must be able to run when it is
        // on. If EliminationQueries is missing, or if it is
        // present but does not export isCharacterEliminatedByYear,
        // the filter cannot honour the user's request. Throwing
        // here matches the __no_class__ precedent below: the
        // user asked for a filter that depends on a module the
        // app has not loaded, and the correct answer is to surface
        // the load-order problem, not to silently return the
        // unfiltered list.
        if (hideEliminated) {
            if (!EliminationQueries) {
                throw new Error(
                    '[CharacterAggregator] getCharacterListViewModel ' +
                    'with hideEliminated=true requires ' +
                    'EliminationQueries. The module is not loaded.'
                );
            }
            if (typeof EliminationQueries
                .isCharacterEliminatedByYear !== 'function') {
                throw new Error(
                    '[CharacterAggregator] getCharacterListViewModel ' +
                    'with hideEliminated=true requires ' +
                    'EliminationQueries.isCharacterEliminatedByYear. ' +
                    'The method is not available.'
                );
            }
        }

        var characters = CharacterQueries.getCharacters() || [];
        var filterYear = resolveFilterYear(options);

        // ---- Class membership + class map ----
        var classMembership = Object.create(null);
        var classMap = Object.create(null);

        if (AcademyClasses) {
            var allClasses = AcademyClasses.getClasses() || [];
            allClasses.forEach(function(cls) {
                if (cls && cls.id) {
                    classMap[cls.id] = cls.name;
                }
            });

            characters.forEach(function(char) {
                if (!char || !char.id) { return; }
                classMembership[char.id] = char.classIds || [];
            });
        }

        // ---- H.1: sentinel comparison through its owner ----
        //
        // getNoClassFilter() reads the sentinel from
        // character-class-view.js. The string is the same one the
        // filter dropdown emits. A literal here would be a second
        // source of truth.
        var noClassFilter = getNoClassFilter();

        if (classFilter === noClassFilter && !AcademyClasses) {
            throw new Error(
                '[CharacterAggregator] ' + noClassFilter +
                ' filter requires AcademyClasses to resolve live ' +
                'class IDs.'
            );
        }

        // ---- Filter FIRST, before the expensive per-character
        // computations. ----

        var nameFilterLower = nameFilter
            ? nameFilter.toLowerCase()
            : null;

        var filtered = characters.filter(function(char) {
            if (!char || typeof char !== 'object') { return false; }

            // 1. hide filler: cheap field check.
            if (hideFiller && char.isFiller === true) {
                return false;
            }

            // 2. name: single getDisplayName.
            if (nameFilterLower) {
                var displayName = CharacterQueries
                    .getDisplayName(char)
                    .toLowerCase();
                if (displayName.indexOf(nameFilterLower) === -1) {
                    return false;
                }
            }

            // 3. class: array lookup.
            if (classFilter === noClassFilter) {
                var charClasses = classMembership[char.id] || [];
                if (charClasses.length !== 0) {
                    var hasReal = false;
                    for (var n = 0; n < charClasses.length; n++) {
                        if (classMap[charClasses[n]]) {
                            hasReal = true;
                            break;
                        }
                    }
                    if (hasReal) { return false; }
                }
            } else if (classFilter !== 'all' && classFilter !== '') {
                var charClasses2 = classMembership[char.id] || [];
                var found = false;
                for (var i = 0; i < charClasses2.length; i++) {
                    if (String(charClasses2[i]) ===
                        String(classFilter)) {
                        found = true;
                        break;
                    }
                }
                if (!found) { return false; }
            }

            // 4. status: one getCurrentStatus per character.
            if (statusFilter !== null) {
                var charStatus = '';
                if (typeof CharacterQueries.getCurrentStatus ===
                    'function') {
                    charStatus =
                        CharacterQueries.getCurrentStatus(char) || '';
                }

                var baseStatus = String(charStatus).toLowerCase();
                var formerIdx = baseStatus.indexOf(' (former)');
                if (formerIdx !== -1) {
                    baseStatus = baseStatus
                        .substring(0, formerIdx).trim();
                } else {
                    baseStatus = baseStatus.trim();
                }

                if (statusFilter.indexOf(baseStatus) === -1) {
                    return false;
                }
            }

            // 5. deceased: isDeceased is cheap.
            if (hideDeceased &&
                isDeceased(char, filterYear)) {
                return false;
            }

            // 6. eliminated: the most expensive filter predicate.
            //
            // H.2 — the pre-check above guarantees that
            // EliminationQueries.isCharacterEliminatedByYear is
            // available when hideEliminated is on. There is no
            // silent fallthrough.
            if (hideEliminated &&
                EliminationQueries.isCharacterEliminatedByYear(
                    char.id, filterYear
                )) {
                return false;
            }

            return true;
        });

        // ---- Now compute the expensive fields, once, for
        // survivors only. ----

        var agesById = Object.create(null);
        var namesById = Object.create(null);
        for (var fi = 0; fi < filtered.length; fi++) {
            var fchar = filtered[fi];
            if (!fchar || !fchar.id) { continue; }
            agesById[fchar.id] =
                CharacterQueries.calculateAge(fchar, filterYear);
            namesById[fchar.id] =
                CharacterQueries.getDisplayName(fchar);
        }

        var deceasedStatus = Object.create(null);
        for (var di = 0; di < filtered.length; di++) {
            var dchar = filtered[di];
            if (!dchar || !dchar.id) { continue; }
            deceasedStatus[dchar.id] = isDeceased(dchar, filterYear);
        }

        var eliminationStatus = Object.create(null);
        if (EliminationQueries) {
            for (var ei = 0; ei < filtered.length; ei++) {
                var echar = filtered[ei];
                if (!echar || !echar.id) { continue; }

                var eliminated = false;
                if (typeof EliminationQueries
                    .isCharacterEliminatedByYear === 'function') {
                    eliminated = EliminationQueries
                        .isCharacterEliminatedByYear(
                            echar.id, filterYear
                        );
                }

                eliminationStatus[echar.id] = {
                    eliminated: eliminated,
                    year: (typeof EliminationQueries
                        .getEliminationYear === 'function')
                        ? EliminationQueries.getEliminationYear(
                            echar.id
                        )
                        : null,
                    week: (typeof EliminationQueries
                        .getEliminationWeek === 'function')
                        ? EliminationQueries.getEliminationWeek(
                            echar.id
                        )
                        : null,
                    reason: (typeof EliminationQueries
                        .getEliminationReason === 'function')
                        ? EliminationQueries.getEliminationReason(
                            echar.id
                        )
                        : 'Unknown'
                };
            }
        }

        var teamStatus = Object.create(null);
        for (var ti = 0; ti < filtered.length; ti++) {
            var tchar = filtered[ti];
            if (!tchar || !tchar.id) { continue; }
            teamStatus[tchar.id] =
                getCurrentProfessionalTeamsForList(
                    tchar.id, filterYear
                );
        }

        // ---- Sort ----
        filtered.sort(makeComparator(sortMode, agesById, namesById));

        // ---- Build result ----
        return filtered.map(function(char) {
            var charClasses = classMembership[char.id] || [];
            var classNames = charClasses.map(function(id) {
                return classMap[id] || 'Unknown';
            }).filter(function(name) {
                return name && name !== 'Unknown';
            });

            var elimStatus = eliminationStatus[char.id] || {
                eliminated: false,
                year: null,
                week: null,
                reason: 'Unknown'
            };

            var teams = teamStatus[char.id] || [];
            var teamNames = teams.map(function(t) { return t.name; });
            var teamIds = teams.map(function(t) { return t.id; });

            var ageValue = agesById[char.id];
            if (ageValue === undefined) { ageValue = null; }
            var ageDisplay = (ageValue === null ||
                ageValue === undefined)
                ? ''
                : String(ageValue);

            return {
                id: char.id,
                name: namesById[char.id] ||
                    CharacterQueries.getDisplayName(char),
                status: CharacterQueries.getCurrentStatus(char),
                age: ageValue,
                ageDisplay: ageDisplay,
                deceased: deceasedStatus[char.id] === true,
                eliminated: elimStatus.eliminated,
                eliminationYear: elimStatus.year,
                eliminationWeek: elimStatus.week,
                eliminationReason: elimStatus.reason,

                classNames: classNames,
                classIds: charClasses,

                teamNames: teamNames,
                teamIds: teamIds,
                teamObjects: teams
            };
        });
    }

    // ============================================================
    // LIST SORT
    // ============================================================

    function makeComparator(sortMode, agesById, namesById) {
        return function(a, b) {
            var nameA = namesById[a.id] || '';
            var nameB = namesById[b.id] || '';

            if (sortMode === 'name-desc') {
                return nameB.localeCompare(nameA);
            }

            if (sortMode === 'age-asc' || sortMode === 'age-desc') {
                var ageA = agesById[a.id];
                var ageB = agesById[b.id];

                if (ageA === undefined) { ageA = null; }
                if (ageB === undefined) { ageB = null; }

                if (ageA === null && ageB === null) {
                    return nameA.localeCompare(nameB);
                }
                if (ageA === null) { return 1; }
                if (ageB === null) { return -1; }
                if (ageA !== ageB) {
                    return sortMode === 'age-asc'
                        ? ageA - ageB
                        : ageB - ageA;
                }
            }

            return nameA.localeCompare(nameB);
        };
    }

    // ============================================================
    // ACADEMIC DATA PROJECTION
    // ============================================================

    function getCharacterAcademicData(characterId, week, options) {
        if (!characterId) { return null; }

        checkDependencies('getCharacterAcademicData');

        var CharacterQueries = getCharacterQueries();
        var TeamQueries = getTeamQueries();
        var EliminationQueries = getEliminationQueries();

        if (!CharacterQueries) { return null; }

        options = options || {};
        var weekNum = week || getCurrentWeek();
        var filterYear = resolveFilterYear(options);

        var char = CharacterQueries.getCharacterById(characterId);
        if (!char) { return null; }

        var academicTeams = [];
        if (TeamQueries) {
            var allTeams = TeamQueries.getTeamsForCharacter(
                characterId
            );
            if (allTeams) {
                academicTeams = formatTeams(
                    filterTeamsByType(allTeams, 'academic'),
                    characterId,
                    'Wk '
                );
            }
        }

        var grades = [];
        var rawGrades = academyGetStudentGrades(characterId);
        grades = rawGrades.map(formatGrade);
        grades.sort(function(a, b) {
            return parseInt(a.week, 10) - parseInt(b.week, 10);
        });

        var classNames = academyGetCharacterClassNames(char);

        var isEliminated = false;
        var eliminationWeek = null;
        var eliminationYear = null;
        var eliminationReason = 'Unknown';
        var tournamentEliminations = [];

        if (EliminationQueries) {
            // Year-scoped, matching the list and detail projections.
            if (typeof EliminationQueries
                .isCharacterEliminatedByYear === 'function') {
                isEliminated = EliminationQueries
                    .isCharacterEliminatedByYear(
                        characterId, filterYear
                    );
            } else if (typeof EliminationQueries
                .isCharacterEliminatedByWeek === 'function') {
                isEliminated = EliminationQueries
                    .isCharacterEliminatedByWeek(
                        characterId, weekNum
                    );
            }

            eliminationWeek =
                (typeof EliminationQueries.getEliminationWeek ===
                    'function')
                ? EliminationQueries.getEliminationWeek(characterId)
                : null;
            eliminationYear =
                (typeof EliminationQueries.getEliminationYear ===
                    'function')
                ? EliminationQueries.getEliminationYear(characterId)
                : null;
            eliminationReason =
                (typeof EliminationQueries.getEliminationReason ===
                    'function')
                ? (EliminationQueries.getEliminationReason(
                    characterId
                ) || 'Unknown')
                : 'Unknown';

            var rawEliminations = char.eliminations || [];
            rawEliminations.forEach(function(elim) {
                if (!elim || elim.standalone) { return; }
                var formatted = formatElimination(elim, characterId);
                if (formatted) {
                    tournamentEliminations.push(formatted);
                }
            });
        }

        return {
            characterId: characterId,
            name: CharacterQueries.getDisplayName(char),
            week: weekNum,
            year: filterYear,
            academicTeams: academicTeams,
            grades: grades,
            classNames: classNames,
            isEliminated: isEliminated,
            eliminationYear: eliminationYear,
            eliminationWeek: eliminationWeek,
            eliminationReason: eliminationReason,
            tournamentEliminations: tournamentEliminations
        };
    }

    // ============================================================
    // PROFESSIONAL DATA PROJECTION
    // ============================================================

    function getCharacterProfessionalData(characterId) {
        if (!characterId) { return null; }

        checkDependencies('getCharacterProfessionalData');

        var CharacterQueries = getCharacterQueries();
        var TeamQueries = getTeamQueries();
        var MissionQueries = getMissionQueries();

        if (!CharacterQueries) { return null; }

        var char = CharacterQueries.getCharacterById(characterId);
        if (!char) { return null; }

        var professionalTeams = [];
        var civilianTeams = [];

        if (TeamQueries) {
            var allTeams = TeamQueries.getTeamsForCharacter(
                characterId
            );
            if (allTeams) {
                // Type comparisons route through
                // normaliseTeamTypeForFilter. The 'temporary'
                // bucket is removed; see filterTeamsByType.
                professionalTeams = formatTeams(
                    filterTeamsByType(allTeams, 'professional'),
                    characterId
                );
                civilianTeams = formatTeams(
                    filterTeamsByType(allTeams, 'civilian'),
                    characterId
                );
            }
        }

        var missions = [];
        if (MissionQueries) {
            var rawMissions =
                MissionQueries.getMissionsForCharacter(
                    characterId
                ) || [];
            missions = rawMissions.map(formatMission);
        }

        var careerStatus = char.careerStatus || [];
        var careerHistory = careerStatus.map(function(statusItem) {
            return {
                status: statusItem.status || 'Unknown',
                startYear: statusItem.startYear || '',
                endYear: statusItem.endYear || '',
                period: formatPeriod(
                    statusItem.startYear, statusItem.endYear
                )
            };
        });

        return {
            characterId: characterId,
            name: CharacterQueries.getDisplayName(char),
            professionalTeams: professionalTeams,
            civilianTeams: civilianTeams,
            // temporaryTeams: retired. 'temporary' normalises to
            // 'professional' and appears in professionalTeams.
            missions: missions,
            careerHistory: careerHistory,
            specialty: char.specialty || '',
            status: CharacterQueries.getCurrentStatus(char)
        };
    }

    // ============================================================
    // SOCIAL DATA PROJECTION
    // ============================================================

    function getCharacterSocialData(characterId) {
        if (!characterId) { return null; }

        checkDependencies('getCharacterSocialData');

        var CharacterQueries = getCharacterQueries();
        var SocialQueries = getSocialQueries();

        if (!CharacterQueries) { return null; }

        var char = CharacterQueries.getCharacterById(characterId);
        if (!char) { return null; }

        var relationships = [];
        if (SocialQueries) {
            var rawRelationships =
                SocialQueries.getCharacterRelationships(
                    characterId
                ) || [];
            relationships = rawRelationships.map(function(rel) {
                return formatRelationship(rel, characterId);
            });
        }

        return {
            characterId: characterId,
            name: CharacterQueries.getDisplayName(char),
            relationships: relationships,
            relationshipCount: relationships.length
        };
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.CharacterAggregator = Object.freeze({
        getCharacterDetail: getCharacterDetail,
        getCharacterListViewModel: getCharacterListViewModel,
        getCharacterAcademicData: getCharacterAcademicData,
        getCharacterProfessionalData: getCharacterProfessionalData,
        getCharacterSocialData: getCharacterSocialData,

        formatPeriod: formatPeriod,
        formatTeams: formatTeams,
        formatGrade: formatGrade,
        formatElimination: formatElimination,
        formatMission: formatMission,
        formatRelationship: formatRelationship,
        getCurrentWeek: getCurrentWeek,
        isDeceased: isDeceased,

        // H.1 — the sentinel this module compares against. Reads
        // from character-class-view.js. Exposed for tests and for
        // callers that need to construct a classFilter that
        // matches the dropdown without redeclaring the literal.
        getNoClassFilter: getNoClassFilter,

        get MIN_WEEK() {
            var CC = getCalendarConstants();
            return CC ? CC.MIN_WEEK || 1 : 1;
        },
        get MAX_WEEK() {
            var CC = getCalendarConstants();
            return CC ? CC.MAX_WEEK || 52 : 52;
        }
    });

    // ============================================================
    // VERIFICATION
    // ============================================================
    //
    // A failed smoke test logs an error but does not throw. The
    // module's public functions are already exported above.

    (function verify() {
        var failures = [];

        try {
            var exports = window.CharacterAggregator;
            var required = [
                'getCharacterDetail',
                'getCharacterListViewModel',
                'getCharacterAcademicData',
                'getCharacterProfessionalData',
                'getCharacterSocialData',
                'getNoClassFilter'
            ];

            for (var i = 0; i < required.length; i++) {
                if (typeof exports[required[i]] !== 'function') {
                    failures.push('missing export: ' + required[i]);
                }
            }

            // H.1 — sentinel agreement.
            //
            // If character-class-view.js is loaded, its sentinel
            // must match the one this module compares against.
            // A mismatch here is the exact bug the H.1 fix closes;
            // surfacing it in the verification block makes the
            // divergence visible on the console, not three
            // interactions later as a filter that matches nothing.
            var CCV = window.CharacterClassView;
            if (CCV && typeof CCV.NO_CLASS_FILTER === 'string') {
                if (exports.getNoClassFilter() !== CCV.NO_CLASS_FILTER) {
                    failures.push(
                        'NO_CLASS_FILTER disagreement: ' +
                        'aggregator=' + exports.getNoClassFilter() +
                        ', class-view=' + CCV.NO_CLASS_FILTER
                    );
                }
            }

            var list = exports.getCharacterListViewModel({
                hideEliminated: false
            });
            if (!Array.isArray(list)) {
                failures.push(
                    'getCharacterListViewModel({hideEliminated:false}) ' +
                    'did not return an array'
                );
            }
        } catch (e) {
            failures.push('smoke test threw: ' + e.message);
        }

        if (failures.length > 0) {
            if (typeof console !== 'undefined' && console.error) {
                console.error(
                    '[CharacterAggregator] Verification failed: ' +
                    failures.join('; ')
                );
            }
        }
    })();

})();
