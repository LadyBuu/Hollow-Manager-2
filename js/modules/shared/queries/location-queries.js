/**
 * js/modules/shared/location-queries.js - Location Queries
 * Read-only location queries
 */

(function() {
    'use strict';

    if (window.__locationQueriesLoaded) return;
    window.__locationQueriesLoaded = true;

    function getLocations() {
        var data = window.data;
        if (!data || !Array.isArray(data.locations)) {
            return [];
        }
        return data.locations.slice();
    }

    function getLocation(id) {
        if (!id) return null;
        var locations = getLocations();
        for (var i = 0; i < locations.length; i++) {
            if (String(locations[i].id) === String(id)) {
                return locations[i];
            }
        }
        return null;
    }

    function getLocationSchedule(locationId, week) {
        var data = window.data;
        if (!data || !data.locationSchedules) return {};
        var key = String(locationId) + '_' + String(week);
        return data.locationSchedules[key] || {};
    }

    window.LocationQueries = {
        getLocations: getLocations,
        getLocation: getLocation,
        getLocationSchedule: getLocationSchedule
    };
})();
