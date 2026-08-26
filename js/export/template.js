/**
 * js/export/template.js - CSV Template Generator
 * Path: js/export/template.js
 */

(function() {
    'use strict';

    function exportTemplateCSV() {
        var records = [
            ['# HOLLOW BLADES CSV', 'FORMAT VERSION', '1'],
            [],
            ['# CHARACTERS'],
            ['CharacterId', 'FirstName', 'MiddleName', 'LastName', 'BirthYear', 'Gender', 'AssociatedNames',
             'EyeColor', 'HairColor', 'SkinColor', 'Height', 'Weight', 'Build', 'AppearanceNotes',
             'Notes', 'Deceased', 'DeathYear', 'DeathCause', 'DeathAge', 'Specialty',
             'CareerStatus', 'EliminatedWeeks'],
            ['', 'John', '', 'Doe', '1990', 'Male', '', 'Blue', 'Brown', 'Fair', '5\'10"', '75kg', 'Athletic',
             '', 'Example character', 'false', '', '', '', '', '[{"status":"trainee","startYear":"1920","endYear":"1923"}]', '[]'],
            ['', 'Jane', 'Mary', 'Smith', '1992', 'Female', 'The Shadow', 'Green', 'Black', 'Olive',
             '5\'7"', '60kg', 'Slim', 'Scar on cheek', '', 'false', '', '', '', '', '[{"status":"trainee","startYear":"1920","endYear":"1923"}]', '[]'],
            [],
            ['# TEAMS'],
            ['TeamId', 'TeamName', 'TeamType', 'StartPeriod', 'EndPeriod', 'CurrentRank', 'Status',
             'NameHistory', 'TemporaryMission', 'TeamNumber', 'ClassId'],
            ['', 'Example Team', 'academic', '1', '2', '1', 'active', '[{"name":"Example Team","startPeriod":"1","endPeriod":"2"}]', '', '', ''],
            ['', 'Another Team', 'academic', '3', '4', '2', 'active', '[{"name":"Another Team","startPeriod":"3","endPeriod":"4"}]', '', '', ''],
            ['', 'Professional Team', 'professional', '1920', '1925', '1', 'active', '[]', '', '', ''],
            [],
            ['# TEAM MEMBERS'],
            ['TeamId', 'CharacterId', 'Role', 'JoinPeriod', 'LeavePeriod', 'Status'],
            ['', '', 'Captain', '1', '', 'active'],
            ['', '', 'Member', '1', '2', 'left'],
            [],
            ['# TEAM RANKINGS'],
            ['TeamId', 'Period', 'Rank'],
            ['', '1', '1'],
            ['', '3', '2'],
            [],
            ['# TOURNAMENTS'],
            ['TournamentId', 'TournamentName', 'Mode', 'StartWeek', 'EndWeek', 'TotalRounds',
             'AcademicYear', 'Status', 'WinnerType', 'WinnerId'],
            ['', 'Spring Cup', 'teams', '1', '4', '1', '1920-1921', 'active', '', ''],
            [],
            ['# TOURNAMENT TEAMS'],
            ['TournamentId', 'TeamId'],
            ['', ''],
            ['', ''],
            [],
            ['# TOURNAMENT MATCHES'],
            ['TournamentId', 'WinnerType', 'Team1Id', 'Team2Id', 'WinnerId'],
            ['', '', '', '', ''],
            [],
            ['# TOURNAMENT ELIMINATIONS'],
            ['TournamentId', 'ParticipantId', 'ParticipantType', 'TeamId', 'Week'],
            ['', '', 'character', '', '2'],
            [],
            ['# TOURNAMENT PARTICIPANTS'],
            ['TournamentId', 'ParticipantId', 'ParticipantType'],
            ['', '', 'character'],
            [],
            ['# MISSIONS'],
            ['MissionId', 'Title', 'Status', 'Priority', 'Difficulty', 'TeamId', 'Location',
             'Duration', 'Pay', 'Progress', 'Objectives'],
            ['', 'Operation Nightfall', 'active', 'high', 'hard', '', 'Berlin',
             '2 weeks', '5000 credits', '50', '[{"text":"Infiltrate base","done":true},{"text":"Retrieve documents","done":true}]'],
            ['', 'Rescue Mission', 'active', 'medium', 'medium', '', 'London',
             '3 days', '2000 credits', '0', '[{"text":"Find hostages","done":false},{"text":"Extract safely","done":false}]'],
            [],
            ['# DISCIPLINES'],
            ['DisciplineId', 'DisciplineName', 'Type', 'Instructors', 'StartWeek', 'EndWeek',
             'WeeklyHours', 'MaxStudents', 'Weight'],
            ['', 'Combat Training', 'mandatory', '[]', '1', '10', '4', '20', '2'],
            ['', 'Stealth', 'mandatory', '[]', '1', '8', '3', '15', '1.5']
        ];

        var csvContent = window.CSV.arrayToCSV(records);
        var blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = 'hollow-blades-template.csv';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        if (typeof window.logActivity === 'function') {
            window.logActivity('Exported template CSV');
        }
    }

    window.exportTemplateCSV = exportTemplateCSV;

})();
