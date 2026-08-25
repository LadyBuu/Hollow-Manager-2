/**
 * js/modules/curriculum/locations.js - Location Management
 * Path: js/modules/curriculum/locations.js
 */

(function() {
    'use strict';

    if (window.__locationsLoaded) return;
    window.__locationsLoaded = true;

    function renderLocationsView(container) {
        if (!container) {
            container = document.getElementById('locations-content');
        }
        if (!container) return;

        if (!window.data) {
            container.innerHTML = '<p class="empty-state">Loading locations data...</p>';
            return;
        }

        if (!window.data.locations) {
            window.data.locations = [];
        }

        container.innerHTML = getLocationsHTML();
        renderLocations();
        initLocationEvents();
    }

    function getLocationsHTML() {
        return `
            <div class="page-header">
                <h2>Locations</h2>
                <button id="add-location-btn" class="primary">+ Add Location</button>
            </div>
            <div id="location-list">
                <div class="list-header" style="display:grid;grid-template-columns:1fr 1fr 0.8fr 0.8fr 0.6fr;gap:8px;padding:8px 12px;background:var(--panel-alt);border-radius:6px 6px 0 0;border:1px solid var(--border);border-bottom:none;font-weight:600;font-size:0.7rem;color:var(--text-dim);">
                    <span>Location Name</span>
                    <span>Type</span>
                    <span>Capacity</span>
                    <span>Description</span>
                    <span>Actions</span>
                </div>
                <div id="locations-container"></div>
            </div>

            <!-- Location Form Modal -->
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
                                <input type="number" id="location-capacity" placeholder="Max students" min="1">
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

    function renderLocations() {
        var container = document.getElementById('locations-container');
        if (!container) return;

        var locations = window.data.locations || [];

        if (locations.length === 0) {
            container.innerHTML = '<p class="empty-state">No locations created yet. Add your first location!</p>';
            return;
        }

        var html = '';
        locations.forEach(function(loc) {
            var typeLabels = {
                'indoor': 'Indoor',
                'outdoor': 'Outdoor',
                'pool': 'Pool',
                'classroom': 'Classroom',
                'lab': 'Lab',
                'field': 'Field',
                'other': 'Other'
            };
            var typeLabel = typeLabels[loc.type] || loc.type || 'Other';
            
            html += '<div class="list-item" style="display:grid;grid-template-columns:1fr 1fr 0.8fr 0.8fr 0.6fr;gap:8px;padding:8px 12px;background:var(--panel);border:1px solid var(--border);border-top:none;">';
            html += '<span><strong>' + loc.name + '</strong></span>';
            html += '<span style="font-size:0.75rem;">' + typeLabel + '</span>';
            html += '<span style="font-size:0.75rem;">' + (loc.capacity || '-') + '</span>';
            html += '<span style="font-size:0.75rem;color:var(--text-dim);">' + (loc.description || '') + '</span>';
            html += '<span class="actions" style="display:flex;gap:4px;">';
            html += '<button class="small edit-location" data-id="' + loc.id + '" style="padding:2px 8px;font-size:0.65rem;">Edit</button>';
            html += '<button class="small danger delete-location" data-id="' + loc.id + '" style="padding:2px 8px;font-size:0.65rem;">Delete</button>';
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
                if (confirm('Delete this location permanently?')) {
                    deleteLocation(this.dataset.id);
                }
            });
        });
    }

    function showLocationForm(editId) {
        var modal = document.getElementById('location-form-modal');
        var title = document.getElementById('location-form-title');
        var form = document.getElementById('location-form-inner');

        modal.classList.remove('hidden');

        if (editId) {
            title.textContent = 'Edit Location';
            var loc = window.data.locations.find(function(l) { return String(l.id) === String(editId); });
            if (loc) {
                document.getElementById('location-name').value = loc.name || '';
                document.getElementById('location-type').value = loc.type || 'indoor';
                document.getElementById('location-capacity').value = loc.capacity || '';
                document.getElementById('location-description').value = loc.description || '';
                form.dataset.editId = editId;
            }
        } else {
            title.textContent = 'Add Location';
            form.reset();
            document.getElementById('location-type').value = 'indoor';
            delete form.dataset.editId;
        }
    }

    function saveLocation(e) {
        e.preventDefault();
        var form = e.target;
        var editId = form.dataset.editId;

        var data = window.data || {};
        if (!data.locations) data.locations = [];

        var locationData = {
            name: document.getElementById('location-name').value.trim(),
            type: document.getElementById('location-type').value,
            capacity: parseInt(document.getElementById('location-capacity').value) || '',
            description: document.getElementById('location-description').value.trim()
        };

        if (!locationData.name) {
            alert('Location name is required.');
            return;
        }

        if (editId) {
            var index = data.locations.findIndex(function(l) { return String(l.id) === String(editId); });
            if (index !== -1) {
                data.locations[index] = Object.assign({}, data.locations[index], locationData);
            }
        } else {
            data.locations.push({
                id: window.generateId('loc'),
                name: locationData.name,
                type: locationData.type,
                capacity: locationData.capacity,
                description: locationData.description,
                createdAt: new Date().toISOString()
            });
        }

        if (typeof window.saveData === 'function') {
            window.saveData().catch(function(err) { /* ignore */ });
        }

        document.getElementById('location-form-modal').classList.add('hidden');
        renderLocations();
        if (typeof window.updateDashboardStats === 'function') {
            window.updateDashboardStats();
        }
    }

    function deleteLocation(id) {
        var data = window.data || {};
        if (!data.locations) return;

        // Check if location is used in any schedules
        var isUsed = false;
        if (data.locationSchedules) {
            for (var key in data.locationSchedules) {
                if (key.indexOf(id + '_') === 0) {
                    isUsed = true;
                    break;
                }
            }
        }

        if (isUsed) {
            if (!confirm('This location is used in schedules. Deleting it will remove it from all schedules. Continue?')) {
                return;
            }
            // Remove from schedules
            for (var key in data.locationSchedules) {
                if (key.indexOf(id + '_') === 0) {
                    delete data.locationSchedules[key];
                }
            }
        }

        data.locations = data.locations.filter(function(l) { return String(l.id) !== String(id); });

        if (typeof window.saveData === 'function') {
            window.saveData().catch(function(err) { /* ignore */ });
        }
        renderLocations();
        if (typeof window.updateDashboardStats === 'function') {
            window.updateDashboardStats();
        }
    }

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
    // REGISTER WITH TABMANAGER
    // ============================================================

    if (typeof window.TabManager !== 'undefined') {
        window.TabManager.register('locations', renderLocationsView);
    }

    document.addEventListener('dataReady', function() {
        var container = document.getElementById('locations-content');
        if (container && container.style.display !== 'none') {
            renderLocationsView(container);
        }
    });

    document.addEventListener('tabChanged', function(e) {
        if (e.detail && e.detail.tab === 'locations') {
            var container = document.getElementById('locations-content');
            if (container) {
                renderLocationsView(container);
            }
        }
    });

    if (window.data) {
        setTimeout(function() {
            var container = document.getElementById('locations-content');
            if (container && container.style.display !== 'none') {
                renderLocationsView(container);
            }
        }, 100);
    }

    window.renderLocationsView = renderLocationsView;
    window.renderLocations = renderLocations;
    window.showLocationForm = showLocationForm;
    window.saveLocation = saveLocation;
    window.deleteLocation = deleteLocation;
    window.initLocationEvents = initLocationEvents;

})();
