/**
 * shared/queries/location-queries.js - Location Queries
 * Read-only location domain queries
 * 
 * IMPORTANT:
 *   - READ ONLY - no mutations
 *   - No dependencies on other modules
 *   - Reads from window.data directly
 * 
 * DEPENDENCIES:
 *   - window.data (canonical state)
 */

(function() {
    'use strict';

    if (window.__locationQueriesLoaded) { return; }
    window.__locationQueriesLoaded = true;

    function getLocations() {
        var data = window.data;
        if (!data || !Array.isArray(data.locations)) {
            return [];
        }
        return data.locations.slice();
    }

    function getLocation(id) {
        if (!id) { return null; }
        var locations = getLocations();
        for (var i = 0; i < locations.length; i++) {
            if (String(locations[i].id) === String(id)) {
                return locations[i];
            }
        }
        return null;
    }

    function getLocationName(id) {
        var loc = getLocation(id);
        return loc ? loc.name : 'Unknown';
    }

    window.LocationQueries = {
        getLocations: getLocations,
        getLocation: getLocation,
        getLocationName: getLocationName
    };

})();
