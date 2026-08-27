/**
 * js/modules/curriculum/locations.js - Location Management
 * Handles location CRUD operations and UI
 * Path: js/modules/curriculum/locations.js
 * 
 * This module is responsible for:
 *   - Rendering the locations UI
 *   - Location CRUD operations (delegates to core)
 *   - Location usage tracking
 * 
 * IMPORTANT: 
 *   - All application-data mutations are delegated to core functions.
 *   - This module does NOT mutate window.data directly.
 *   - UI state is managed locally.
 *   - Persistence is coordinated through the central saveData() function.
 *   - This module calls saveData() after successful mutations.
 *   - Core functions do not perform persistence themselves.
 * 
 * LIFECYCLE:
 *   This module is rendered by curriculum-main.js via TabManager.
 *   It does not independently listen for lifecycle events.
 * 
 * ARCHITECTURAL NOTE:
 *   - Locations are stored as { id, name, type, capacity, description, createdAt }
 *   - Location schedules are stored separately in locationSchedules[locationId_week][day][hour]
 *   - All core mutation functions return { success: boolean, message?: string, ... }
 *   - getLocationUsage() returns a number (count of schedule entries using this location)
 *   - deleteLocation() cleans up all associated locationSchedules.
 */

(function() {
    'use strict';

    // ============================================================
    // RENDER LOCATIONS VIEW - Public API (only this is exposed)
    // ============================================================

    function renderLocationsView(container) {
        if (!container) {
            container = document.getElementById('locations-content');
        }
        if (!container) return;

        if (!window.data) {
            container.innerHTML = '<p class="empty-state">Loading locations data...</p>';
            return;
        }

        if (typeof window.ensureCurriculum !== 'function') {
            console.error('[Locations] ensureCurriculum() is not available.');
            container.innerHTML = '<p class="empty-state">Curriculum schema module not loaded. Please refresh the page.</p>';
            return;
        }

        window.ensureCurriculum();

        // Verify all core dependencies
        var requiredDeps = [
            { name: 'getLocations', fn: window.getLocations },
            { name: 'createLocation', fn: window.createLocation },
            { name: 'updateLocation', fn: window.updateLocation },
            { name: 'deleteLocation', fn: window.deleteLocation },
            { name: 'getLocationUsage', fn: window.getLocationUsage }
        ];

        for (var i = 0; i < requiredDeps.length; i++) {
            if (typeof requiredDeps[i].fn !== 'function') {
                console.error('[Locations] ' + requiredDeps[i].name + '() is not available.');
                container.innerHTML = '<p class="empty-state">Locations core module not loaded. Please refresh the page.</p>';
                return;
            }
        }

        container.innerHTML = getLocationsHTML();
        renderLocations();
        initLocationEvents();
    }

    // ============================================================
    // HTML ESCAPING
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
    // TYPE LABELS - Constant (moved outside loop)
    // ============================================================

    var TYPE_LABELS = {
        'indoor': 'Indoor',
        'outdoor': 'Outdoor',
        'pool': 'Pool',
        'classroom': 'Classroom',
        'lab': 'Lab',
        'field': 'Field',
        'other': 'Other'
    };

    function getTypeLabel(type) {
        return TYPE_LABELS[type] || type || 'Other';
    }

    // ============================================================
    // LOCATIONS HTML
    // ============================================================

    function getLocationsHTML() {
        return `
            <div class="page-header">
                <h2>Locations</h2>
                <button id="add-location-btn" class="primary">+ Add Location</button>
            </div>
            <div id="location-list">
                <div class="list-header" style="display:grid;grid-template-columns:1fr 1fr 0.8fr 1.2fr 0.6fr;gap:8px;padding:8px 12px;background:var(--panel-alt);border-radius:6px 6px 0 0;border:1px solid var(--border);border-bottom:none;font-weight:600;font-size:0.7rem;color:var(--text-dim);">
                    <span>Location Name</span>
                    <span>Type</span>
                    <span>Capacity</span>
                    <span>Description</span>
                    <span>Actions</span>
                </div>
                <div id="locations-container"></div>
            </div>

            <div id="location-form-modal" class="modal hidden">
                <div class="modal-content" style="max-width:500px;">
                    <div class="modal-header">
                        <h3 id="location-form-title">Add Location</h3>
                        <button class="close-modal" id="close-location-form">&times;</button>
                    </div>
                    <div class="modal-body">
                        <form id="location-form-inner">
                            <div class="form-group">
                                <label>Location Name *</label>
                                <input type="text" id="location-name" placeholder="e.g., Main Gym, Swimming Pool, Room 101" required>
                            </div>
                            <div class="form-group">
                                <label>Type</label>
                                <select id="location-type">
                                    <option value="indoor">Indoor</option>
                                    <option value="outdoor">Outdoor</option>
                                    <option value="pool">Pool</option>
                                    <option value="classroom">Classroom</option>
                                    <option value="lab">Lab</option>
                                    <option value="field">Field</option>
                                    <option value="other">Other</option>
                                </select>
                            </div>
                            <div class="form-group">
                                <label>Capacity</label>
                                <input type="number" id="location-capacity" placeholder="Max students" min="0" step="1">
                            </div>
                            <div class="form-group full-width">
                                <label>Description</label>
                                <textarea id="location-description" rows="2" placeholder="Additional details about this location..."></textarea>
                            </div>
                            <div class="form-actions">
                                <button type="button" id="cancel-location-form" class="secondary">Cancel</button>
                                <button type="submit" id="save-location-btn" class="primary">Save Location</button>
                            </div>
                        </form>
                    </div>
                </div>
            </div>
        `;
    }

    // ============================================================
    // RENDER LOCATIONS - READ-ONLY
    // ============================================================

    function renderLocations() {
        var container = document.getElementById('locations-container');
        if (!container) return;

        var locations = window.getLocations();

        if (locations.length === 0) {
            container.innerHTML = '<p class="empty-state">No locations created yet. Add your first location!</p>';
            return;
        }

        var html = '';
        locations.forEach(function(loc) {
            var typeLabel = getTypeLabel(loc.type);
            var capacityDisplay = loc.capacity !== null && loc.capacity !== undefined && loc.capacity !== ''
                ? loc.capacity
                : '-';
            var descriptionDisplay = loc.description || '';

            var safeId = escapeHtml(loc.id);
            var safeName = escapeHtml(loc.name);
            var safeType = escapeHtml(typeLabel);
            var safeCapacity = escapeHtml(String(capacityDisplay));
            var safeDescription = escapeHtml(descriptionDisplay);

            // getLocationUsage returns a number (count of schedule entries using this location)
            var usageCount = window.getLocationUsage(loc.id);
            var isUsed = usageCount > 0;

            var usedIndicator = isUsed
                ? ' <span style="color:var(--warning);font-size:0.6rem;">(' + usageCount + ' schedule' + (usageCount > 1 ? 's' : '') + ')</span>'
                : '';

            html += '<div class="list-item" style="display:grid;grid-template-columns:1fr 1fr 0.8fr 1.2fr 0.6fr;gap:8px;padding:8px 12px;background:var(--panel);border:1px solid var(--border);border-top:none;" data-id="' + safeId + '">';
            html += '<span><strong>' + safeName + '</strong>' + usedIndicator + '</span>';
            html += '<span style="font-size:0.75rem;">' + safeType + '</span>';
            html += '<span style="font-size:0.75rem;">' + safeCapacity + '</span>';
            html += '<span style="font-size:0.75rem;color:var(--text-dim);">' + safeDescription + '</span>';
            html += '<span class="actions" style="display:flex;gap:4px;">';
            html += '<button class="small edit-location" data-id="' + safeId + '">Edit</button>';
            html += '<button class="small danger delete-location" data-id="' + safeId + '">Delete</button>';
            html += '</span>';
            html += '</div>';
        });
        container.innerHTML = html;

        container.querySelectorAll('.edit-location').forEach(function(btn) {
            btn.addEventListener('click', function() {
                showLocationForm(this.dataset.id);
            });
        });

        container.querySelectorAll('.delete-location').forEach(function(btn) {
            btn.addEventListener('click', function() {
                deleteLocationHandler(this.dataset.id);
            });
        });
    }

    // ============================================================
    // DELETE LOCATION HANDLER
    // ============================================================

    function deleteLocationHandler(id) {
        var locations = window.getLocations();
        var location = null;
        for (var i = 0; i < locations.length; i++) {
            if (String(locations[i].id) === String(id)) {
                location = locations[i];
                break;
            }
        }

        if (!location) {
            showNotification('Location not found.', 'error');
            return;
        }

        var usageCount = window.getLocationUsage(id);
        var isUsed = usageCount > 0;

        var message = 'Delete "' + location.name + '" permanently?';
        if (isUsed) {
            message += '\n\n⚠ This location is used in ' + usageCount + ' schedule' + (usageCount > 1 ? 's' : '') +
                '. Deleting it will remove it from all schedules.';
        }

        if (!confirm(message)) {
            return;
        }

        var result = window.deleteLocation(id);
        if (result && result.success) {
            renderLocations();
            if (typeof window.updateDashboardStats === 'function') {
                window.updateDashboardStats();
            }

            if (typeof window.saveData === 'function') {
                window.saveData()
                    .then(function() {
                        showNotification('Location deleted successfully!', 'success');
                    })
                    .catch(function(err) {
                        console.error('Failed to save location deletion:', err);
                        showNotification('Location deleted in memory, but persistence failed.', 'error');
                    });
            } else {
                showNotification('Location deleted successfully!', 'success');
            }
        } else {
            showNotification(result && result.message ? result.message : 'Failed to delete location.', 'error');
        }
    }

    // ============================================================
    // SHOW LOCATION FORM
    // ============================================================

    function showLocationForm(editId) {
        var modal = document.getElementById('location-form-modal');
        var title = document.getElementById('location-form-title');
        var form = document.getElementById('location-form-inner');

        if (!modal || !title || !form) {
            showNotification('Form elements not found. Please refresh.', 'error');
            return;
        }

        modal.classList.remove('hidden');

        if (editId) {
            title.textContent = 'Edit Location';
            var locations = window.getLocations();
            var loc = null;
            for (var i = 0; i < locations.length; i++) {
                if (String(locations[i].id) === String(editId)) {
                    loc = locations[i];
                    break;
                }
            }

            if (loc) {
                document.getElementById('location-name').value = loc.name || '';
                document.getElementById('location-type').value = loc.type || 'indoor';
                document.getElementById('location-capacity').value = loc.capacity !== null && loc.capacity !== undefined && loc.capacity !== '' ? loc.capacity : '';
                document.getElementById('location-description').value = loc.description || '';
                form.dataset.editId = editId;
            } else {
                showNotification('Location not found.', 'error');
                modal.classList.add('hidden');
                return;
            }
        } else {
            title.textContent = 'Add Location';
            form.reset();
            document.getElementById('location-type').value = 'indoor';
            delete form.dataset.editId;
        }
    }

    // ============================================================
    // SAVE LOCATION
    // ============================================================

    function saveLocation(e) {
        e.preventDefault();
        var form = e.target;
        var editId = form.dataset.editId;

        var name = document.getElementById('location-name').value.trim();
        var type = document.getElementById('location-type').value;
        var capacityValue = document.getElementById('location-capacity').value;
        var description = document.getElementById('location-description').value.trim();

        if (!name) {
            showNotification('Location name is required.', 'error');
            return;
        }

        // Strict capacity validation
        var capacity = null;
        if (capacityValue !== '' && capacityValue !== undefined && capacityValue !== null) {
            var parsed = Number(capacityValue);
            if (!Number.isInteger(parsed) || parsed < 0) {
                showNotification('Capacity must be a whole number of 0 or greater.', 'error');
                return;
            }
            capacity = parsed;
        }

        var locationData = {
            name: name,
            type: type,
            capacity: capacity,
            description: description
        };

        var result;
        if (editId) {
            result = window.updateLocation(editId, locationData);
            if (!result || !result.success) {
                showNotification(result && result.message ? result.message : 'Failed to update location.', 'error');
                return;
            }
        } else {
            result = window.createLocation(locationData);
            if (!result || !result.success) {
                showNotification(result && result.message ? result.message : 'Failed to create location.', 'error');
                return;
            }
        }

        document.getElementById('location-form-modal').classList.add('hidden');
        renderLocations();

        if (typeof window.updateDashboardStats === 'function') {
            window.updateDashboardStats();
        }

        if (typeof window.saveData === 'function') {
            window.saveData()
                .then(function() {
                    showNotification(editId ? 'Location updated successfully!' : 'Location created successfully!', 'success');
                })
                .catch(function(err) {
                    console.error('Failed to save location:', err);
                    showNotification('Location changed in memory, but persistence failed.', 'error');
                });
        } else {
            showNotification(editId ? 'Location updated successfully!' : 'Location created successfully!', 'success');
        }
    }

    // ============================================================
    // NOTIFICATION HELPER
    // ============================================================

    function showNotification(message, type) {
        type = type || 'info';
        
        if (typeof window.showToast === 'function') {
            window.showToast(message, type);
            return;
        }
        
        if (type === 'error') {
            alert('Error: ' + message);
        } else if (type === 'success') {
            alert(message);
        } else {
            console.log('[Locations]', message);
        }
    }

    // ============================================================
    // EVENT INITIALISATION
    // ============================================================

    function initLocationEvents() {
        var addBtn = document.getElementById('add-location-btn');
        if (addBtn) {
            addBtn.addEventListener('click', function() {
                showLocationForm();
            });
        }

        var closeBtn = document.getElementById('close-location-form');
        if (closeBtn) {
            closeBtn.addEventListener('click', function() {
                document.getElementById('location-form-modal').classList.add('hidden');
            });
        }

        var cancelBtn = document.getElementById('cancel-location-form');
        if (cancelBtn) {
            cancelBtn.addEventListener('click', function() {
                document.getElementById('location-form-modal').classList.add('hidden');
            });
        }

        var form = document.getElementById('location-form-inner');
        if (form) {
            form.addEventListener('submit', saveLocation);
        }

        var modal = document.getElementById('location-form-modal');
        if (modal) {
            modal.addEventListener('click', function(e) {
                if (e.target === this) {
                    this.classList.add('hidden');
                }
            });
        }
    }

    // ============================================================
    // REGISTER WITH CURRICULUM MAIN - NO INDEPENDENT LIFECYCLE
    // This module is rendered by curriculum-main.js via TabManager.
    // It does not independently listen for lifecycle events.
    // ============================================================

    // EXPOSE PUBLIC API
    window.renderLocationsView = renderLocationsView;

})();
