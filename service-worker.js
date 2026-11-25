/* Hollow Manager 2 service worker.
 * Pre-caches every local script and stylesheet referenced by index.html.
 * Relative paths support deployment under a GitHub Pages project prefix.
 */
'use strict';

var CACHE_NAME = 'hollow-manager-shell-v8';
var SHELL_FILES = [
    './index.html',
    './word-hoard/',
    './word-hoard/index.html',
    './word-hoard/style.css',
    './word-hoard/word-hoard.js',
    './manifest.webmanifest',
    './service-worker.js',
    './icons/app-icon.svg',
    './css/shared.css',
    './css/dashboard.css',
    './css/characters.css',
    './css/teams.css',
    './css/social.css',
    './css/missions.css',
    './css/departments.css',
    './css/academy.css',
    './css/academy/modals.css',
    './css/academy/ranking.css',
    './css/academy/exams.css',
    './css/academy/discipline.css',
    './css/academy/location.css',
    './css/academy/weekly-teams.css',
    './css/academy/character-detail.css',
    './css/academy/class-detail.css',
    './css/academy/shared-groups.css',
    './css/calendar.css',
    './js/utils/object-utils.js',
    './js/utils/id-utils.js',
    './js/utils/validation-utils.js',
    './js/utils/format-utils.js',
    './js/utils/dom-utils.js',
    './js/utils/form-utils.js',
    './js/utils/timing-utils.js',
    './js/utils/modal.js',
    './js/utils/notification.js',
    './js/utils/theme-manager.js',
    './js/modules/shared/constants.js',
    './js/modules/shared/calendar-constants.js',
    './js/modules/shared/calendar-config.js',
    './js/modules/characters/character-constants.js',
    './js/modules/shared/academy-constants.js',
    './js/modules/shared/magic-constants.js',
    './js/modules/shared/social-constants.js',
    './js/modules/teams/team-constants.js',
    './js/modules/tournaments/tournament-schema.js',
    './js/modules/shared/tournament-constants.js',
    './js/modules/missions/mission-constants.js',
    './js/modules/missions/mission-id.js',
    './js/utils/calendar-validation.js',
    './js/utils/range-utils.js',
    './js/modules/tournaments/tournament-rules.js',
    './js/modules/characters/character-queries.js',
    './js/modules/teams/team-queries.js',
    './js/modules/shared/queries/tournament-queries.js',
    './js/modules/missions/mission-queries.js',
    './js/modules/shared/queries/social-queries.js',
    './js/modules/shared/queries/discipline-queries.js',
    './js/modules/shared/queries/location-queries.js',
    './js/modules/tournaments/elimination-queries.js',
    './js/core/activity-log.js',
    './js/core/mutation-pipeline.js',
    './js/import-export/export-utils.js',
    './js/import-export/import-result.js',
    './js/import-export/csv-parser.js',
    './js/import-export/export-schema.js',
    './js/import-export/export-envelope.js',
    './js/import-export/format-migrations.js',
    './js/import-export/cross-domain-validator.js',
    './js/import-export/import-pipeline.js',
    './js/import-export/json-io.js',
    './js/import-export/calendar-import.js',
    './js/import-export/character-export.js',
    './js/modules/missions/mission-csv.js',
    './js/import-export/character-export-picker.js',
    './js/core/database.js',
    './js/core/loader.js',
    './js/core/state.js',
    './js/core/tab-manager.js',
    './js/modules/teams/member-manager.js',
    './js/modules/calendar/calendar-renderer.js',
    './js/modules/academy/academy-grade-schemes.js',
    './js/modules/academy/academy-classes.js',
    './js/modules/academy/academy-grades.js',
    './js/modules/academy/academy-disciplines.js',
    './js/modules/academy/academy-locations.js',
    './js/modules/academy/academy-cascade.js',
    './js/modules/academy/academy-eliminations.js',
    './js/modules/academy/academy-settings.js',
    './js/modules/academy/academy-enrolments.js',
    './js/modules/academy/academy-social-score.js',
    './js/modules/academy/academy-performance.js',
    './js/modules/academy/academy-ranking.js',
    './js/modules/academy/academy-class-disciplines-queries.js',
    './js/modules/academy/academy-class-disciplines.js',
    './js/modules/academy/academy-discipline-sessions-panel.js',
    './js/modules/academy/academy-teaching-groups.js',
    './js/modules/academy/academy-teaching-sessions.js',
    './js/modules/academy/academy-instructor-commitments.js',
    './js/modules/academy/academy-teaching-projector.js',
    './js/modules/academy/academy-teaching-collisions.js',
    './js/modules/academy/academy-teaching-validation.js',
    './js/modules/academy/academy-schedule.js',
    './js/modules/academy/academy-calendar-aggregator.js',
    './js/modules/academy/academy-weekly-teams.js',
    './js/modules/academy/academy-aggregator.js',
    './js/modules/academy/academy-ui.js',
    './js/modules/academy/member-adapter-academy.js',
    './js/modules/academy/academy-balance-suggestions.js',
    './js/modules/social/social-core.js',
    './js/modules/social/social-aggregator.js',
    './js/modules/social/social-matcher.js',
    './js/modules/social/social-child-factory.js',
    './js/modules/social/social-views.js',
    './js/modules/social/social-graph.js',
    './js/modules/social/social-events.js',
    './js/modules/social/index.js',
    './js/modules/characters/character-generator.js',
    './js/modules/characters/character-stats.js',
    './js/modules/characters/character-moves.js',
    './js/modules/characters/character-crud.js',
    './js/modules/characters/character-strip.js',
    './js/modules/characters/filler-manager-modal.js',
    './js/modules/characters/character-aggregator.js',
    './js/modules/characters/character-list.js',
    './js/modules/characters/character-form.js',
    './js/modules/characters/character-detail.js',
    './js/modules/characters/character-class-view.js',
    './js/modules/characters/character-stats-view.js',
    './js/modules/characters/character-views.js',
    './js/modules/characters/character-bulk-create.js',
    './js/import-export/character-json-io.js',
    './js/modules/characters/career-status-wizard.js',
    './js/modules/characters/character-events.js',
    './js/modules/characters/index.js',
    './js/modules/research/research-queries.js',
    './js/modules/research/research-view.js',
    './js/modules/research/research-events.js',
    './js/modules/research/index.js',
    './js/modules/tournaments/tournament-elimination-cascade.js',
    './js/modules/tournaments/tournament-cascade.js',
    './js/modules/tournaments/tournament-matches.js',
    './js/modules/tournaments/tournament-core.js',
    './js/modules/academy/academy-character-detail-aggregator.js',
    './js/modules/academy/academy-class-detail.js',
    './js/modules/academy/academy-class-populate.js',
    './js/modules/academy/academy-grades-editor.js',
    './js/modules/academy/academy-character-detail.js',
    './js/modules/academy/academy-discipline-view.js',
    './js/modules/academy/academy-discipline-schedule-summary.js',
    './js/modules/academy/academy-location-view.js',
    './js/modules/academy/academy-ranking-view.js',
    './js/modules/academy/academy-weekly-teams-view.js',
    './js/modules/academy/academy-shared-groups-view.js',
    './js/modules/academy/academy-tournament-view.js',
    './js/modules/academy/academy-tournament-events.js',
    './js/modules/academy/academy-tournament-aggregator.js',
    './js/modules/academy/academy-crud-modals.js',
    './js/modules/academy/academy-class-disciplines-picker.js',
    './js/modules/academy/academy-enrollment-modal.js',
    './js/modules/academy/academy-schedule-assign-modal.js',
    './js/modules/academy/academy-schedule-instructor-modal.js',
    './js/modules/academy/academy-session-form-modal.js',
    './js/modules/academy/academy-session-actions-modal.js',
    './js/modules/academy/academy-group-management-modal.js',
    './js/modules/academy/academy-rebalance-modal.js',
    './js/modules/academy/academy-view.js',
    './js/modules/teams/team-aggregator.js',
    './js/modules/teams/team-ui.js',
    './js/modules/teams/team-render.js',
    './js/modules/teams/team-core.js',
    './js/modules/teams/team-naming.js',
    './js/modules/teams/team-kill-modal.js',
    './js/modules/teams/team-matchmaking.js',
    './js/modules/teams/team-matchmaking-view.js',
    './js/modules/teams/timeline-queries.js',
    './js/modules/teams/timeline-view.js',
    './js/modules/teams/team-rankings-view.js',
    './js/modules/teams/member-adapter-teams.js',
    './js/modules/teams/team-verifier.js',
    './js/modules/teams/team-verifier-view.js',
    './js/import-export/team-export.js',
    './js/import-export/candidate-export.js',
    './js/import-export/team-export-picker.js',
    './js/modules/teams/team-events.js',
    './js/modules/teams/index.js',
    './js/modules/departments/department-constants.js',
    './js/modules/departments/department-schema.js',
    './js/modules/departments/department-queries.js',
    './js/modules/departments/department-core.js',
    './js/modules/departments/department-aggregator.js',
    './js/modules/departments/department-render.js',
    './js/modules/departments/department-events.js',
    './js/modules/departments/index.js',
    './js/modules/academy/academy-instructor-repair-view.js',
    './js/modules/academy/controllers/controller-contract.js',
    './js/modules/academy/controllers/academy-controllers.js',
    './js/modules/academy/controllers/academy-people-controller.js',
    './js/modules/academy/controllers/academy-exam-controller.js',
    './js/modules/academy/controllers/academy-weekly-teams-controller.js',
    './js/modules/academy/controllers/academy-ranking-controller.js',
    './js/modules/academy/controllers/academy-discipline-controller.js',
    './js/modules/academy/controllers/academy-location-controller.js',
    './js/modules/academy/controllers/academy-repair-controller.js',
    './js/modules/academy/controllers/academy-shared-groups-controller.js',
    './js/modules/academy/academy-weekly-teams-operations.js',
    './js/modules/academy/index.js',
    './js/modules/missions/mission-schema.js',
    './js/modules/missions/mission-rules.js',
    './js/modules/missions/mission-cascade.js',
    './js/modules/missions/mission-core.js',
    './js/modules/missions/mission-views.js',
    './js/modules/missions/mission-export.js',
    './js/modules/missions/mission-import.js',
    './js/modules/missions/mission-render.js',
    './js/modules/missions/mission-aggregator.js',
    './js/modules/missions/mission-rookie-picker.js',
    './js/modules/missions/mission-ui.js',
    './js/modules/missions/index.js',
    './js/import-export/class-roster-export.js',
    './js/import-export/schedule-export.js',
    './js/import-export/graduates-export-picker.js',
    './js/import-export/ui.js',
    './js/import-export/index.js',
    './js/modules/application/application-settings-core.js',
    './js/modules/application/application-settings-queries.js',
    './js/modules/dashboard/dashboard-aggregator.js',
    './js/modules/dashboard/dashboard-render.js',
    './js/modules/dashboard/dashboard-ui.js',
    './js/modules/dashboard/index.js',
    './js/core/bootstrap.js',
    './js/app.js'
];

self.addEventListener('install', function(event) {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(function(cache) { return cache.addAll(SHELL_FILES); })
            .then(function() { return self.skipWaiting(); })
    );
});

self.addEventListener('activate', function(event) {
    event.waitUntil(
        caches.keys().then(function(keys) {
            return Promise.all(keys.map(function(key) {
                if (key.indexOf('hollow-manager-shell-') === 0 && key !== CACHE_NAME) {
                    return caches.delete(key);
                }
                return Promise.resolve(false);
            }));
        }).then(function() { return self.clients.claim(); })
    );
});

self.addEventListener('fetch', function(event) {
    var request = event.request;
    if (request.method !== 'GET') return;

    var url;
    try { url = new URL(request.url); } catch (error) { return; }
    if (url.origin !== self.location.origin) return;

    if (request.mode === 'navigate') {
        event.respondWith(
            fetch(request).then(function(response) {
                if (!response || !response.ok) return response;
                var copy = response.clone();
                return caches.open(CACHE_NAME).then(function(cache) {
                    return cache.put('./index.html', copy).then(function() {
                        return response;
                    }, function() {
                        return response;
                    });
                });
            }).catch(function() {
                return caches.match(request).then(function(cached) {
                    return cached || caches.match('./index.html');
                });
            })
        );
        return;
    }

    // Network-first keeps installed clients current. Cache writes are part
    // of the response chain so the worker cannot be terminated mid-write.
    event.respondWith(
        fetch(request).then(function(response) {
            if (!response || !response.ok || response.type !== 'basic') return response;
            var copy = response.clone();
            return caches.open(CACHE_NAME).then(function(cache) {
                return cache.put(request, copy).then(function() {
                    return response;
                }, function() {
                    return response;
                });
            });
        }).catch(function() {
            return caches.match(request);
        })
    );
});
