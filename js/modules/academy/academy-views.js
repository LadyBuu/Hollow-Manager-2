/**
 * js/modules/academy/academy-views.js - Academy Views
 * UI rendering for the academy module
 * Path: js/modules/academy/academy-views.js
 * 
 * This module is responsible for:
 *   - Rendering the main academy container
 *   - Rendering sub-tab content (class, student, faculty)
 *   - Rendering class list and detail
 *   - Rendering student list and detail
 *   - Rendering instructor list and detail
 *   - Rendering location schedules
 *   - Rendering auto-groups
 *   - Rendering disciplines
 * 
 * IMPORTANT:
 *   - RENDER ONLY - no event binding
 *   - No data mutations
 *   - No persistence calls
 *   - All user-controlled data is escaped using DomUtils.escapeHtml()
 *   - Delegates to sub-tab renderers for complex content
 * 
 * DEPENDENCIES:
 *   - window.AcademyQueries (from academy-queries.js)
 *   - window.AcademyCore (from academy-core.js)
 *   - window.CharacterQueries (from character-queries.js)
 *   - window.ClassTab (from tabs/class-tab.js)
 *   - window.StudentTab (from tabs/student-tab.js)
 *   - window.FacultyTab (from tabs/faculty-tab.js)
 *   - window.DomUtils (from dom-utils.js)
 */

(function() {
    'use strict';

    // Guard against duplicate loading
    if (window.__academyViewsLoaded) {
        return;
    }

    // ============================================================
    // DEPENDENCY IMPORTS - NO FALLBACKS
    // ============================================================

    var AcademyQueries = window.AcademyQueries;
    var AcademyCore = window.AcademyCore;
    var CharacterQueries = window.CharacterQueries;
    var ClassTab = window.ClassTab;
    var StudentTab = window.StudentTab;
    var FacultyTab = window.FacultyTab;
    var DomUtils = window.DomUtils;

    // ============================================================
    // DEPENDENCY CHECK
    // ============================================================

    function checkDependencies() {
        var missing = [];

        if (!AcademyQueries || typeof AcademyQueries.getClasses !== 'function') {
            missing.push('AcademyQueries.getClasses');
        }
        if (!AcademyQueries || typeof AcademyQueries.getClass !== 'function') {
            missing.push('AcademyQueries.getClass');
        }
        if (!AcademyQueries || typeof AcademyQueries.getClassStudents !== 'function') {
            missing.push('AcademyQueries.getClassStudents');
        }
        if (!AcademyQueries || typeof AcademyQueries.getAcademicTeams !== 'function') {
            missing.push('AcademyQueries.getAcademicTeams');
        }
        if (!AcademyQueries || typeof AcademyQueries.getTournaments !== 'function') {
            missing.push('AcademyQueries.getTournaments');
        }
        if (!AcademyQueries || typeof AcademyQueries.getAvailableDisciplines !== 'function') {
            missing.push('AcademyQueries.getAvailableDisciplines');
        }
        if (!AcademyQueries || typeof AcademyQueries.getDisciplines !== 'function') {
            missing.push('AcademyQueries.getDisciplines');
        }
        if (!AcademyQueries || typeof AcademyQueries.getLocations !== 'function') {
            missing.push('AcademyQueries.getLocations');
        }
        if (!AcademyQueries || typeof AcademyQueries.getInstructors !== 'function') {
            missing.push('AcademyQueries.getInstructors');
        }
        if (!AcademyQueries || typeof AcademyQueries.getStudents !== 'function') {
            missing.push('AcademyQueries.getStudents');
        }

        if (!CharacterQueries || typeof CharacterQueries.getDisplayName !== 'function') {
            missing.push('CharacterQueries.getDisplayName');
        }
        if (!CharacterQueries || typeof CharacterQueries.getCurrentStatus !== 'function') {
            missing.push('CharacterQueries.getCurrentStatus');
        }

        if (!ClassTab || typeof ClassTab.render !== 'function') {
            missing.push('ClassTab.render');
        }

        if (!StudentTab || typeof StudentTab.render !== 'function') {
            missing.push('StudentTab.render');
        }

        if (!FacultyTab || typeof FacultyTab.render !== 'function') {
            missing.push('FacultyTab.render');
        }

        if (!DomUtils || typeof DomUtils.escapeHtml !== 'function') {
            missing.push('DomUtils.escapeHtml');
        }

        if (missing.length > 0) {
            console.warn('AcademyViews: Missing dependencies:', missing.join(', '));
            return false;
        }

        return true;
    }

    if (!checkDependencies()) {
        return;
    }

    window.__academyViewsLoaded = true;

    // ============================================================
    // HTML ESCAPING - Delegates to DomUtils
    // ============================================================

    function escapeHtml(value) {
        return DomUtils.escapeHtml(value);
    }

    // ============================================================
    // ACADEMY CONTAINER HTML
    // ============================================================

    function renderAcademy(state) {
        var activeSubTab = state.activeSubTab || 'class';

        var html = '';

        // Header
        html += '<div class="academy-header">';
        html += '<h2>Academic Year</h2>';
        html += '<div class="academy-header-actions">';
        html += '<button id="academy-refresh-btn" class="small secondary">↻ Refresh</button>';
        html += '</div>';
        html += '</div>';

        // Tabs
        html += renderAcademyTabs(activeSubTab);

        // Content container
        html += '<div id="academy-subtab-content">';
        html += '<!-- Sub-tab content will be rendered here -->';
        html += '</div>';

        return html;
    }

    // ============================================================
    // ACADEMY TABS HTML
    // ============================================================

    function renderAcademyTabs(activeSubTab) {
        activeSubTab = activeSubTab || 'class';

        var tabs = [
            { id: 'class', label: 'Classes' },
            { id: 'student', label: 'Students' },
            { id: 'faculty', label: 'Faculty' }
        ];

        var html = '';
        html += '<div class="academy-tab-nav">';
        for (var i = 0; i < tabs.length; i++) {
            var tab = tabs[i];
            var isActive = tab.id === activeSubTab;
            html += '<button class="tab-btn' + (isActive ? ' active' : '') + '" data-tab="' + escapeHtml(tab.id) + '">' + escapeHtml(tab.label) + '</button>';
        }
        html += '</div>';

        return html;
    }

    // ============================================================
    // SUB-TAB RENDERERS - Delegates to sub-tab modules
    // ============================================================

    function renderClassTab(state) {
        if (ClassTab && typeof ClassTab.render === 'function') {
            return ClassTab.render(state);
        }
        return '<p class="empty-state">Class tab not available.</p>';
    }

    function renderStudentTab(state) {
        if (StudentTab && typeof StudentTab.render === 'function') {
            return StudentTab.render(state);
        }
        return '<p class="empty-state">Student tab not available.</p>';
    }

    function renderFacultyTab(state) {
        if (FacultyTab && typeof FacultyTab.render === 'function') {
            return FacultyTab.render(state);
        }
        return '<p class="empty-state">Faculty tab not available.</p>';
    }

    // ============================================================
    // CLASS LIST RENDERER
    // ============================================================

    function renderClassList(state) {
        var classes = AcademyQueries.getClasses();
        var selectedId = state.selectedClassId;

        if (classes.length === 0) {
            return '<p class="empty-state">No classes created yet.</p>';
        }

        var html = '';
        for (var i = 0; i < classes.length; i++) {
            var cls = classes[i];
            var count = AcademyQueries.getClassStudentCount(cls.id);
            var teamCount = AcademyQueries.getClassTeamCount(cls.id);
            var isSelected = selectedId === cls.id;

            html += '<div class="class-list-item' + (isSelected ? ' selected' : '') + '" data-id="' + escapeHtml(cls.id) + '">';
            html += '<div class="class-list-item-content">';
            html += '<span class="class-list-item-name">' + escapeHtml(cls.name) + '</span>';
            html += '<span class="class-list-item-meta">' + count + ' students, ' + teamCount + ' teams</span>';
            html += '</div>';
            html += '</div>';
        }

        return html;
    }

    // ============================================================
    // CLASS DETAIL RENDERER
    // ============================================================

    function renderClassDetail(state, cls) {
        if (!cls) {
            return '<p class="empty-state">Class not found.</p>';
        }

        var students = AcademyQueries.getClassStudents(cls.id);
        var teams = AcademyQueries.getAcademicTeams(cls.id);
        var tournaments = AcademyQueries.getTournaments(cls.id);
        var week = state.selectedWeek || 1;

        var html = '';

        // Header
        html += '<div class="class-detail-header">';
        html += '<h3 class="class-detail-title">' + escapeHtml(cls.name) + '</h3>';
        html += '<div class="class-detail-actions">';
        html += '<button class="edit-class-btn secondary small" data-id="' + escapeHtml(cls.id) + '">Edit</button>';
        html += '<button class="distribute-class-btn primary small" data-id="' + escapeHtml(cls.id) + '">Distribute</button>';
        html += '<button class="delete-class-btn danger small" data-id="' + escapeHtml(cls.id) + '">Delete</button>';
        html += '</div>';
        html += '</div>';

        // Stats
        html += '<div class="class-detail-stats">';
        html += '<div class="stat-item"><span class="stat-label">Students</span><span class="stat-value">' + students.length + '</span></div>';
        html += '<div class="stat-item"><span class="stat-label">Teams</span><span class="stat-value">' + teams.length + '</span></div>';
        html += '<div class="stat-item"><span class="stat-label">Tournaments</span><span class="stat-value">' + tournaments.length + '</span></div>';
        html += '</div>';

        // Tabs within detail
        html += '<div class="class-detail-tabs">';
        html += '<button class="detail-tab-btn active" data-tab="roster">Roster</button>';
        html += '<button class="detail-tab-btn" data-tab="teams">Teams</button>';
        html += '<button class="detail-tab-btn" data-tab="tournaments">Tournaments</button>';
        html += '</div>';

        // Roster tab
        html += '<div class="detail-tab-panel active" data-tab="roster">';
        html += renderClassRoster(state, cls, students);
        html += '</div>';

        // Teams tab
        html += '<div class="detail-tab-panel" data-tab="teams" style="display:none;">';
        html += renderClassTeams(state, cls, teams);
        html += '</div>';

        // Tournaments tab
        html += '<div class="detail-tab-panel" data-tab="tournaments" style="display:none;">';
        html += renderClassTournaments(state, cls, tournaments);
        html += '</div>';

        return html;
    }

    // ============================================================
    // CLASS ROSTER RENDERER
    // ============================================================

    function renderClassRoster(state, cls, students) {
        var html = '';

        // Add student form
        html += '<div class="roster-add-form">';
        html += '<select id="roster-add-student" class="small">';
        html += '<option value="">Add student...</option>';

        var available = AcademyQueries.getAvailableStudents(cls.id, state.selectedWeek || 1);
        for (var i = 0; i < available.length; i++) {
            var student = available[i];
            var name = CharacterQueries.getDisplayName(student);
            html += '<option value="' + escapeHtml(student.id) + '">' + escapeHtml(name) + '</option>';
        }

        html += '</select>';
        html += '<button id="roster-add-btn" class="primary small">Add</button>';
        html += '</div>';

        // Student list
        if (students.length === 0) {
            html += '<p class="empty-state small">No students in this class.</p>';
        } else {
            html += '<div class="roster-list">';
            for (var j = 0; j < students.length; j++) {
                var s = students[j];
                var name = CharacterQueries.getDisplayName(s);
                var status = CharacterQueries.getCurrentStatus(s);
                var isDeceased = s.deceased || false;

                html += '<div class="roster-item' + (isDeceased ? ' deceased' : '') + '">';
                html += '<span class="roster-name">' + escapeHtml(name) + '</span>';
                html += '<span class="roster-status">(' + escapeHtml(status) + ')</span>';
                html += '<button class="roster-remove-btn small danger" data-student="' + escapeHtml(s.id) + '">x</button>';
                html += '</div>';
            }
            html += '</div>';
        }

        return html;
    }

    // ============================================================
    // CLASS TEAMS RENDERER
    // ============================================================

    function renderClassTeams(state, cls, teams) {
        var html = '';

        // Add team form
        html += '<div class="teams-add-form">';
        html += '<input type="text" id="team-add-name" placeholder="Team name" class="small">';
        html += '<input type="text" id="team-add-number" placeholder="Number (optional)" class="small">';
        html += '<button id="team-add-btn" class="primary small">+ Add Team</button>';
        html += '</div>';

        if (teams.length === 0) {
            html += '<p class="empty-state small">No academic teams for this class.</p>';
        } else {
            html += '<div class="teams-list">';
            for (var i = 0; i < teams.length; i++) {
                var team = teams[i];
                var memberCount = AcademyCore.getAcademicTeamMemberCount(team.id, state.selectedWeek || 1);

                html += '<div class="team-item">';
                html += '<div class="team-item-header">';
                html += '<span class="team-name"><strong>' + escapeHtml(team.name) + '</strong>';
                if (team.teamNumber) {
                    html += ' <span class="team-number">(#' + escapeHtml(team.teamNumber) + ')</span>';
                }
                html += ' <span class="team-count">' + memberCount + ' members</span>';
                html += '</span>';
                html += '<div class="team-actions">';
                html += '<button class="team-manage-members small" data-team="' + escapeHtml(team.id) + '">Members</button>';
                html += '<button class="team-delete-btn small danger" data-team="' + escapeHtml(team.id) + '">x</button>';
                html += '</div>';
                html += '</div>';

                // Members (collapsed by default)
                html += '<div class="team-members-list" style="display:none;">';
                var members = AcademyCore.getAcademicTeamMembers(team.id, state.selectedWeek || 1);
                if (members.length === 0) {
                    html += '<p class="empty-state small">No members</p>';
                } else {
                    for (var j = 0; j < members.length; j++) {
                        var member = members[j];
                        var char = CharacterQueries.getCharacterById(member.characterId);
                        var name = char ? CharacterQueries.getDisplayName(char) : 'Unknown';
                        html += '<div class="team-member-item">';
                        html += '<span>' + escapeHtml(name) + '</span>';
                        html += '<span class="team-member-role">' + escapeHtml(member.role || 'Member') + '</span>';
                        html += '<button class="team-member-remove small danger" data-team="' + escapeHtml(team.id) + '" data-student="' + escapeHtml(member.characterId) + '">x</button>';
                        html += '</div>';
                    }
                }
                html += '</div>';
                html += '</div>';
            }
            html += '</div>';
        }

        // Distribute button
        html += '<div class="teams-distribute">';
        html += '<button id="distribute-class-btn" class="primary" data-class="' + escapeHtml(cls.id) + '">Auto-Distribute Students</button>';
        html += '</div>';

        return html;
    }

    // ============================================================
    // CLASS TOURNAMENTS RENDERER
    // ============================================================

    function renderClassTournaments(state, cls, tournaments) {
        var html = '';

        // Add tournament form
        html += '<div class="tournament-add-form">';
        html += '<input type="text" id="tournament-add-name" placeholder="Tournament name" class="small">';
        html += '<input type="text" id="tournament-add-desc" placeholder="Description (optional)" class="small">';
        html += '<input type="number" id="tournament-add-week" placeholder="Week" value="' + (state.selectedWeek || 1) + '" class="small" min="1" max="52">';
        html += '<button id="tournament-add-btn" class="primary small">+ Add Tournament</button>';
        html += '</div>';

        if (tournaments.length === 0) {
            html += '<p class="empty-state small">No tournaments for this class.</p>';
        } else {
            html += '<div class="tournaments-list">';
            for (var i = 0; i < tournaments.length; i++) {
                var t = tournaments[i];

                html += '<div class="tournament-item">';
                html += '<div class="tournament-item-header">';
                html += '<span class="tournament-name"><strong>' + escapeHtml(t.name) + '</strong>';
                if (t.description) {
                    html += ' <span class="tournament-desc">- ' + escapeHtml(t.description) + '</span>';
                }
                html += ' <span class="tournament-week">(Week ' + escapeHtml(t.week) + ')</span>';
                html += ' <span class="tournament-status">' + escapeHtml(t.status || 'active') + '</span>';
                html += '</span>';
                html += '<div class="tournament-actions">';
                html += '<button class="tournament-manage-teams small" data-tournament="' + escapeHtml(t.id) + '">Teams</button>';
                html += '<button class="tournament-delete-btn small danger" data-tournament="' + escapeHtml(t.id) + '">x</button>';
                html += '</div>';
                html += '</div>';

                // Teams list (collapsed by default)
                html += '<div class="tournament-teams-list" style="display:none;">';
                var teams = AcademyCore.getTournamentTeams(t.id);
                if (teams.length === 0) {
                    html += '<p class="empty-state small">No teams in this tournament.</p>';
                    html += '<div class="tournament-add-team-form">';
                    html += '<select class="tournament-team-select small">';
                    html += '<option value="">Add team...</option>';
                    var availableTeams = AcademyQueries.getAcademicTeams(cls.id);
                    for (var j = 0; j < availableTeams.length; j++) {
                        var at = availableTeams[j];
                        var inTournament = false;
                        for (var k = 0; k < teams.length; k++) {
                            if (String(teams[k].id) === String(at.id)) {
                                inTournament = true;
                                break;
                            }
                        }
                        if (!inTournament) {
                            html += '<option value="' + escapeHtml(at.id) + '">' + escapeHtml(at.name) + '</option>';
                        }
                    }
                    html += '</select>';
                    html += '<button class="tournament-add-team-btn small primary" data-tournament="' + escapeHtml(t.id) + '">Add</button>';
                    html += '</div>';
                } else {
                    for (var j = 0; j < teams.length; j++) {
                        var team = teams[j];
                        html += '<div class="tournament-team-item">';
                        html += '<span>' + escapeHtml(team.name) + '</span>';
                        html += '<button class="tournament-remove-team small danger" data-tournament="' + escapeHtml(t.id) + '" data-team="' + escapeHtml(team.id) + '">x</button>';
                        html += '</div>';
                    }
                    html += '<div class="tournament-add-team-form">';
                    html += '<select class="tournament-team-select small">';
                    html += '<option value="">Add team...</option>';
                    var availableTeams2 = AcademyQueries.getAcademicTeams(cls.id);
                    for (var j2 = 0; j2 < availableTeams2.length; j2++) {
                        var at2 = availableTeams2[j2];
                        var inTournament2 = false;
                        for (var k2 = 0; k2 < teams.length; k2++) {
                            if (String(teams[k2].id) === String(at2.id)) {
                                inTournament2 = true;
                                break;
                            }
                        }
                        if (!inTournament2) {
                            html += '<option value="' + escapeHtml(at2.id) + '">' + escapeHtml(at2.name) + '</option>';
                        }
                    }
                    html += '</select>';
                    html += '<button class="tournament-add-team-btn small primary" data-tournament="' + escapeHtml(t.id) + '">Add</button>';
                    html += '</div>';
                }
                html += '</div>';
                html += '</div>';
            }
            html += '</div>';
        }

        return html;
    }

    // ============================================================
    // STUDENT DETAIL RENDERER
    // ============================================================

    function renderStudentDetail(state, student) {
        if (!student) {
            return '<p class="empty-state">Student not found.</p>';
        }

        var studentId = student.id;
        var week = state.selectedWeek || 1;
        var name = CharacterQueries.getDisplayName(student);
        var status = CharacterQueries.getCurrentStatus(student);

        var grades = AcademyCore.getStudentGrades(studentId, week);
        var summary = AcademyCore.calculateGradeSummary(studentId, week);
        var rankings = AcademyCore.getRankings(week);
        var studentRank = AcademyCore.getStudentRank(week, studentId);
        var schedule = AcademyCore.getStudentSchedule(studentId, week);
        var restDays = AcademyCore.getStudentRestDays(studentId, week);

        var html = '';

        // Header
        html += '<div class="student-detail-header">';
        html += '<h3 class="student-detail-name">' + escapeHtml(name) + '</h3>';
        html += '<span class="student-detail-status">' + escapeHtml(status) + '</span>';
        if (student.deceased) {
            html += '<span class="student-detail-deceased">[Deceased]</span>';
        }
        html += '</div>';

        // Tabs within detail
        html += '<div class="student-detail-tabs">';
        html += '<button class="detail-tab-btn active" data-tab="grades">Grades</button>';
        html += '<button class="detail-tab-btn" data-tab="ranking">Ranking</button>';
        html += '<button class="detail-tab-btn" data-tab="schedule">Schedule</button>';
        html += '</div>';

        // Grades tab
        html += '<div class="detail-tab-panel active" data-tab="grades">';
        html += renderStudentGrades(student, week, grades, summary);
        html += '</div>';

        // Ranking tab
        html += '<div class="detail-tab-panel" data-tab="ranking" style="display:none;">';
        html += renderStudentRanking(student, week, rankings, studentRank);
        html += '</div>';

        // Schedule tab
        html += '<div class="detail-tab-panel" data-tab="schedule" style="display:none;">';
        html += renderStudentSchedule(student, week, schedule, restDays);
        html += '</div>';

        return html;
    }

    // ============================================================
    // STUDENT GRADES RENDERER
    // ============================================================

    function renderStudentGrades(student, week, grades, summary) {
        var html = '';

        // Summary stats
        html += '<div class="grades-summary">';
        if (summary) {
            html += '<div class="stat-item"><span class="stat-label">Average</span><span class="stat-value">' + 
                (summary.average !== null ? summary.average.toFixed(1) + '%' : '--') + '</span></div>';
            html += '<div class="stat-item"><span class="stat-label">Graded</span><span class="stat-value">' + 
                summary.gradedCount + '/' + summary.scheduledCount + '</span></div>';
            html += '<div class="stat-item"><span class="stat-label">Weighted</span><span class="stat-value">' + 
                summary.totalWeight.toFixed(1) + '</span></div>';
        } else {
            html += '<div class="stat-item"><span class="stat-label">No grades</span></div>';
        }
        html += '</div>';

        // Grade table
        var disciplines = AcademyQueries.getAvailableDisciplines(week);
        if (disciplines.length === 0) {
            html += '<p class="empty-state small">No disciplines available this week.</p>';
        } else {
            html += '<div class="grades-table-container">';
            html += '<table class="grades-table">';
            html += '<thead>';
            html += '<tr>';
            html += '<th>Discipline</th>';
            html += '<th>Type</th>';
            html += '<th>Weight</th>';
            html += '<th>Score</th>';
            html += '<th>Letter</th>';
            html += '<th>Weighted</th>';
            html += '</tr>';
            html += '</thead>';
            html += '<tbody>';

            for (var i = 0; i < disciplines.length; i++) {
                var disc = disciplines[i];
                var score = grades[disc.id] !== undefined ? grades[disc.id] : '';
                var letter = '';
                var weighted = '';

                if (score !== '' && score !== null) {
                    var numScore = parseFloat(score);
                    if (!isNaN(numScore) && numScore >= 0 && numScore <= 100) {
                        letter = AcademyCore.getGradeLetter(disc, numScore);
                        var weight = parseFloat(disc.weight) || 1;
                        weighted = (numScore * weight).toFixed(1);
                    }
                }

                var isMandatory = disc.type === 'mandatory';

                html += '<tr>';
                html += '<td>' + escapeHtml(disc.name) + '</td>';
                html += '<td>' + (isMandatory ? 'Mandatory' : 'Optional') + '</td>';
                html += '<td>' + escapeHtml(disc.weight || '1') + '</td>';
                html += '<td>';
                html += '<input type="number" class="grade-input" data-discipline="' + escapeHtml(disc.id) + '" ';
                html += 'value="' + escapeHtml(score) + '" min="0" max="100" step="0.5" ';
                html += 'style="width:60px;padding:2px 4px;font-size:0.7rem;">';
                html += '</td>';
                html += '<td class="grade-letter">' + escapeHtml(letter) + '</td>';
                html += '<td class="weighted-score">' + escapeHtml(weighted) + '</td>';
                html += '</tr>';
            }

            html += '</tbody>';
            html += '</table>';
            html += '</div>';

            html += '<div class="grades-actions">';
            html += '<button id="grades-save-btn" class="primary small">Save Grades</button>';
            html += '</div>';
        }

        return html;
    }

    // ============================================================
    // STUDENT RANKING RENDERER
    // ============================================================

    function renderStudentRanking(student, week, rankings, studentRank) {
        var html = '';

        // Header
        html += '<div class="ranking-header">';
        html += '<div class="ranking-info">';
        html += '<span class="ranking-label">Your Rank:</span>';
        html += '<span class="ranking-value">' + (studentRank !== null ? '#' + studentRank : 'Unranked') + '</span>';
        html += '<span class="ranking-total">of ' + rankings.length + ' students</span>';
        html += '</div>';
        html += '<div class="ranking-actions">';
        html += '<button id="ranking-auto-btn" class="primary small">Auto-Generate</button>';
        html += '<button id="ranking-refresh-btn" class="secondary small">Refresh</button>';
        html += '</div>';
        html += '</div>';

        // Ranking table
        if (rankings.length === 0) {
            html += '<p class="empty-state small">No rankings for this week.</p>';
        } else {
            html += '<div class="ranking-table-container">';
            html += '<table class="ranking-table">';
            html += '<thead>';
            html += '<tr>';
            html += '<th>Rank</th>';
            html += '<th>Student</th>';
            html += '<th>Status</th>';
            html += '<th>Average</th>';
            html += '</tr>';
            html += '</thead>';
            html += '<tbody>';

            for (var i = 0; i < rankings.length; i++) {
                var entry = rankings[i];
                var char = CharacterQueries.getCharacterById(entry.studentId);
                var name = char ? CharacterQueries.getDisplayName(char) : 'Unknown';
                var status = char ? CharacterQueries.getCurrentStatus(char) : '';
                var isCurrent = String(entry.studentId) === String(student.id);

                var summary = AcademyCore.calculateGradeSummary(entry.studentId, week);
                var avg = summary && summary.average !== null ? summary.average.toFixed(1) + '%' : '--';

                html += '<tr class="' + (isCurrent ? 'current-student' : '') + '">';
                html += '<td><strong>#' + entry.rank + '</strong></td>';
                html += '<td>' + escapeHtml(name) + (isCurrent ? ' <span class="current-badge">(You)</span>' : '') + '</td>';
                html += '<td>' + escapeHtml(status) + '</td>';
                html += '<td>' + escapeHtml(avg) + '</td>';
                html += '</tr>';
            }

            html += '</tbody>';
            html += '</table>';
            html += '</div>';
        }

        return html;
    }

    // ============================================================
    // STUDENT SCHEDULE RENDERER
    // ============================================================

    function renderStudentSchedule(student, week, schedule, restDays) {
        var dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
        var hours = [];
        for (var h = 8; h <= 18; h++) {
            hours.push(h);
        }

        var html = '';

        // Rest days
        html += '<div class="schedule-rest-days">';
        html += '<label>Rest Days:</label>';
        html += '<div class="rest-days-checkboxes">';
        for (var d = 1; d <= 7; d++) {
            var checked = restDays.indexOf(d) !== -1;
            html += '<label class="rest-day-check">';
            html += '<input type="checkbox" class="rest-day-checkbox" value="' + d + '" ' + (checked ? 'checked' : '') + '>';
            html += dayNames[d - 1];
            html += '</label>';
        }
        html += '</div>';
        html += '<button id="schedule-rest-days-save" class="small secondary">Save Rest Days</button>';
        html += '</div>';

        // Schedule grid
        html += '<div class="schedule-grid-container">';
        html += '<table class="schedule-grid">';
        html += '<thead>';
        html += '<tr><th>Time</th>';
        for (var d2 = 1; d2 <= 7; d2++) {
            html += '<th>' + dayNames[d2 - 1] + '</th>';
        }
        html += '</tr>';
        html += '</thead>';
        html += '<tbody>';

        for (var h2 = 0; h2 < hours.length; h2++) {
            var hour = hours[h2];
            var timeLabel = hour + ':00';
            html += '<tr>';
            html += '<td class="schedule-time">' + timeLabel + '</td>';

            for (var d3 = 1; d3 <= 7; d3++) {
                var classId = schedule[d3] && schedule[d3][hour] ? schedule[d3][hour] : null;
                var display = '';
                var className = 'schedule-empty';
                var duration = 1;
                var instructorName = '';

                if (restDays.indexOf(d3) !== -1) {
                    display = '--';
                    className = 'schedule-rest';
                } else if (classId) {
                    var disc = AcademyCore.getDiscipline(classId);
                    display = disc ? disc.name : 'Unknown';
                    className = 'schedule-class';
                    duration = AcademyCore.getClassDuration(student.id, week, d3, hour) || 1;
                    var instructorId = AcademyCore.getClassInstructor(student.id, week, d3, hour);
                    if (instructorId) {
                        var instructor = CharacterQueries.getCharacterById(instructorId);
                        if (instructor) {
                            instructorName = CharacterQueries.getDisplayName(instructor);
                        }
                    }
                } else {
                    display = '·';
                    className = 'schedule-empty';
                }

                var dataAttrs = '';
                if (classId) {
                    dataAttrs = ' data-discipline="' + escapeHtml(classId) + '"';
                }

                html += '<td class="' + className + '" data-day="' + d3 + '" data-hour="' + hour + '"' + dataAttrs + '>';
                html += '<span class="schedule-cell-content">' + escapeHtml(display) + '</span>';
                if (classId && duration > 1) {
                    html += '<span class="schedule-duration">' + duration + 'h</span>';
                }
                if (instructorName) {
                    html += '<span class="schedule-instructor">(' + escapeHtml(instructorName) + ')</span>';
                }
                html += '</td>';
            }

            html += '</tr>';
        }

        html += '</tbody>';
        html += '</table>';
        html += '</div>';

        return html;
    }

    // ============================================================
    // INSTRUCTOR DETAIL RENDERER
    // ============================================================

    function renderInstructorDetail(state, instructor) {
        if (!instructor) {
            return '<p class="empty-state">Instructor not found.</p>';
        }

        var instructorId = instructor.id;
        var week = state.selectedWeek || 1;
        var name = CharacterQueries.getDisplayName(instructor);

        var templates = AcademyCore.getInstructorTemplates(instructorId, week);
        var blocks = AcademyCore.getInstructorBlocks(instructorId, week);

        var html = '';

        // Header
        html += '<div class="instructor-detail-header">';
        html += '<h4>' + escapeHtml(name) + '</h4>';
        html += '<span class="instructor-detail-week">Week ' + week + '</span>';
        html += '</div>';

        // Tabs
        html += '<div class="instructor-detail-tabs">';
        html += '<button class="detail-tab-btn active" data-tab="schedule">Schedule</button>';
        html += '<button class="detail-tab-btn" data-tab="blocks">Blocks</button>';
        html += '</div>';

        // Schedule tab
        html += '<div class="detail-tab-panel active" data-tab="schedule">';
        html += renderInstructorSchedule(instructor, week, templates);
        html += '</div>';

        // Blocks tab
        html += '<div class="detail-tab-panel" data-tab="blocks" style="display:none;">';
        html += renderInstructorBlocks(instructor, week, blocks);
        html += '</div>';

        return html;
    }

    // ============================================================
    // INSTRUCTOR SCHEDULE RENDERER
    // ============================================================

    function renderInstructorSchedule(instructor, week, templates) {
        var html = '';

        // Add template form
        html += '<div class="schedule-add-form">';
        html += '<select id="schedule-discipline-select" class="small">';
        html += '<option value="">Select discipline...</option>';
        var disciplines = AcademyQueries.getAvailableDisciplines(week);
        for (var i = 0; i < disciplines.length; i++) {
            var d = disciplines[i];
            html += '<option value="' + escapeHtml(d.id) + '">' + escapeHtml(d.name) + '</option>';
        }
        html += '</select>';
        html += '<select id="schedule-day-select" class="small">';
        var days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
        for (var d2 = 0; d2 < days.length; d2++) {
            html += '<option value="' + (d2 + 1) + '">' + days[d2] + '</option>';
        }
        html += '</select>';
        html += '<select id="schedule-hour-select" class="small">';
        for (var h = 8; h <= 18; h++) {
            html += '<option value="' + h + '">' + h + ':00</option>';
        }
        html += '</select>';
        html += '<select id="schedule-duration-select" class="small">';
        html += '<option value="1">1 hour</option>';
        html += '<option value="2">2 hours</option>';
        html += '<option value="3">3 hours</option>';
        html += '<option value="4">4 hours</option>';
        html += '</select>';
        html += '<button id="schedule-add-btn" class="primary small">Add</button>';
        html += '</div>';

        // Schedule grid
        html += '<div class="schedule-grid-container">';
        html += '<table class="schedule-grid">';
        html += '<thead>';
        html += '<tr><th>Time</th>';
        for (var d3 = 1; d3 <= 7; d3++) {
            html += '<th>' + days[d3 - 1] + '</th>';
        }
        html += '</tr>';
        html += '</thead>';
        html += '<tbody>';

        for (var h2 = 8; h2 <= 18; h2++) {
            html += '<tr>';
            html += '<td class="schedule-time">' + h2 + ':00</td>';

            for (var d4 = 1; d4 <= 7; d4++) {
                var key = d4 + '_' + h2;
                var template = templates[key] || null;
                var display = '';
                var className = 'schedule-empty';

                if (template) {
                    var disc = AcademyCore.getDiscipline(template.disciplineId);
                    display = disc ? disc.name : 'Unknown';
                    className = 'schedule-class';
                    if (template.assignedStudents && template.assignedStudents.length > 0) {
                        display += ' (' + template.assignedStudents.length + ')';
                    }
                } else {
                    display = '·';
                    className = 'schedule-empty';
                }

                html += '<td class="' + className + '" data-day="' + d4 + '" data-hour="' + h2 + '"';
                if (template) {
                    html += ' data-discipline="' + escapeHtml(template.disciplineId) + '"';
                    html += ' data-duration="' + escapeHtml(template.duration) + '"';
                }
                html += '>';
                html += '<span class="schedule-cell-content">' + escapeHtml(display) + '</span>';
                if (template) {
                    html += '<button class="schedule-remove-btn small danger" data-day="' + d4 + '" data-hour="' + h2 + '">x</button>';
                }
                html += '</td>';
            }

            html += '</tr>';
        }

        html += '</tbody>';
        html += '</table>';
        html += '</div>';

        return html;
    }

    // ============================================================
    // INSTRUCTOR BLOCKS RENDERER
    // ============================================================

    function renderInstructorBlocks(instructor, week, blocks) {
        var html = '';

        // Add block form
        html += '<div class="blocks-add-form">';
        html += '<select id="block-day-select" class="small">';
        var days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
        for (var d = 0; d < days.length; d++) {
            html += '<option value="' + (d + 1) + '">' + days[d] + '</option>';
        }
        html += '</select>';
        html += '<select id="block-hour-select" class="small">';
        for (var h = 8; h <= 18; h++) {
            html += '<option value="' + h + '">' + h + ':00</option>';
        }
        html += '</select>';
        html += '<select id="block-duration-select" class="small">';
        html += '<option value="1">1 hour</option>';
        html += '<option value="2">2 hours</option>';
        html += '<option value="3">3 hours</option>';
        html += '<option value="4">4 hours</option>';
        html += '</select>';
        html += '<input type="text" id="block-label-input" placeholder="Label (optional)" class="small">';
        html += '<button id="block-add-btn" class="warning small">Add Block</button>';
        html += '</div>';

        // Blocks list
        var blockEntries = [];
        for (var day in blocks) {
            if (!Object.prototype.hasOwnProperty.call(blocks, day)) { continue; }
            var dayBlocks = blocks[day];
            for (var hour in dayBlocks) {
                if (!Object.prototype.hasOwnProperty.call(dayBlocks, hour)) { continue; }
                var block = dayBlocks[hour];
                blockEntries.push({
                    day: parseInt(day, 10),
                    hour: parseInt(hour, 10),
                    duration: block.duration || 1,
                    label: block.label || 'Blocked'
                });
            }
        }

        if (blockEntries.length === 0) {
            html += '<p class="empty-state small">No blocks set.</p>';
        } else {
            blockEntries.sort(function(a, b) {
                if (a.day !== b.day) { return a.day - b.day; }
                return a.hour - b.hour;
            });

            html += '<div class="blocks-list">';
            for (var i = 0; i < blockEntries.length; i++) {
                var b = blockEntries[i];
                var dayName = days[b.day - 1];
                html += '<div class="block-item">';
                html += '<span class="block-day">' + dayName + '</span>';
                html += '<span class="block-time">' + b.hour + ':00 - ' + (b.hour + b.duration) + ':00</span>';
                html += '<span class="block-label">' + escapeHtml(b.label) + '</span>';
                html += '<button class="block-remove-btn small danger" data-day="' + b.day + '" data-hour="' + b.hour + '">x</button>';
                html += '</div>';
            }
            html += '</div>';
        }

        return html;
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.AcademyViews = {
        // Main container
        renderAcademy: renderAcademy,
        renderAcademyTabs: renderAcademyTabs,

        // Sub-tab renderers
        renderClassTab: renderClassTab,
        renderStudentTab: renderStudentTab,
        renderFacultyTab: renderFacultyTab,

        // Class renderers
        renderClassList: renderClassList,
        renderClassDetail: renderClassDetail,
        renderClassRoster: renderClassRoster,
        renderClassTeams: renderClassTeams,
        renderClassTournaments: renderClassTournaments,

        // Student renderers
        renderStudentDetail: renderStudentDetail,
        renderStudentGrades: renderStudentGrades,
        renderStudentRanking: renderStudentRanking,
        renderStudentSchedule: renderStudentSchedule,

        // Instructor renderers
        renderInstructorDetail: renderInstructorDetail,
        renderInstructorSchedule: renderInstructorSchedule,
        renderInstructorBlocks: renderInstructorBlocks,

        // HTML utilities
        escapeHtml: escapeHtml
    };

})();