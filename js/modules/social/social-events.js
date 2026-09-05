/**
 * modules/social/social-events.js - Social Events
 * Event orchestration for the social/relationship domain
 * Path: js/modules/social/social-events.js
 * 
 * This module provides:
 *   - init - Bind all event listeners
 *   - destroy - Clean up all event listeners
 *   - handleAddRelationship - Open relationship form
 *   - handleSaveRelationship - Save relationship (create/update)
 *   - handleDeleteRelationship - Delete relationship with confirmation
 *   - handleFilterChange - Refresh view on filter change
 *   - handleViewModeChange - Switch between list and graph views
 *   - handleGraphNodeClick - Show character detail
 *   - handleCharacterDetailClose - Close detail modal
 * 
 * IMPORTANT:
 *   - Orchestrates UI interactions
 *   - Calls SocialCore for mutations
 *   - Calls SocialViews for rendering
 *   - Calls SocialGraph for graph rendering
 *   - Uses Modal for modal lifecycle
 *   - Uses NotificationSystem for notifications
 *   - No direct data mutation
 *   - No direct DOM manipulation (delegates to Views)
 * 
 * DEPENDENCIES:
 *   - window.SocialCore (from social-core.js) - MANDATORY
 *   - window.SocialViews (from social-views.js) - MANDATORY
 *   - window.SocialQueries (from social-queries.js) - MANDATORY
 *   - window.SocialGraph (from social-graph.js) - MANDATORY
 *   - window.CharacterQueries (from character-queries.js) - MANDATORY
 *   - window.Modal (from modal.js) - MANDATORY
 *   - window.NotificationSystem (from notification.js) - MANDATORY
 * 
 * USAGE:
 *   var SE = window.SocialEvents;
 *   SE.init(container);
 *   // Later:
 *   SE.destroy();
 */

(function() {
    'use strict';

    // Guard against duplicate loading
    if (window.__socialEventsLoaded) {
        return;
    }
    window.__socialEventsLoaded = true;

    // ============================================================
    // DEPENDENCY IMPORTS - MANDATORY (no fallbacks)
    // ============================================================

    var SocialCore = window.SocialCore;
    var SocialViews = window.SocialViews;
    var SocialQueries = window.SocialQueries;
    var SocialGraph = window.SocialGraph;
    var CharacterQueries = window.CharacterQueries;
    var Modal = window.Modal;
    var NotificationSystem = window.NotificationSystem;

    // ============================================================
    // DEPENDENCY CHECK
    // ============================================================

    function checkDependencies() {
        var missing = [];

        if (!SocialCore || typeof SocialCore.createRelationship !== 'function') {
            missing.push('SocialCore.createRelationship');
        }
        if (!SocialCore || typeof SocialCore.updateRelationship !== 'function') {
            missing.push('SocialCore.updateRelationship');
        }
        if (!SocialCore || typeof SocialCore.deleteRelationship !== 'function') {
            missing.push('SocialCore.deleteRelationship');
        }

        if (!SocialViews || typeof SocialViews.renderSocialView !== 'function') {
            missing.push('SocialViews.renderSocialView');
        }
        if (!SocialViews || typeof SocialViews.renderRelationships !== 'function') {
            missing.push('SocialViews.renderRelationships');
        }
        if (!SocialViews || typeof SocialViews.renderCharacterDetailContent !== 'function') {
            missing.push('SocialViews.renderCharacterDetailContent');
        }

        if (!SocialQueries || typeof SocialQueries.getRelationshipById !== 'function') {
            missing.push('SocialQueries.getRelationshipById');
        }

        if (!SocialGraph || typeof SocialGraph.setGraphVisible !== 'function') {
            missing.push('SocialGraph.setGraphVisible');
        }
        if (!SocialGraph || typeof SocialGraph.renderGraph !== 'function') {
            missing.push('SocialGraph.renderGraph');
        }

        if (!CharacterQueries || typeof CharacterQueries.getCharacterById !== 'function') {
            missing.push('CharacterQueries.getCharacterById');
        }

        if (!Modal || typeof Modal.showModal !== 'function') {
            missing.push('Modal.showModal');
        }
        if (!Modal || typeof Modal.closeModal !== 'function') {
            missing.push('Modal.closeModal');
        }

        if (!NotificationSystem || typeof NotificationSystem.notify !== 'function') {
            missing.push('NotificationSystem.notify');
        }

        if (missing.length > 0) {
            console.warn('[SocialEvents] Missing dependencies:', missing.join(', '));
            return false;
        }

        return true;
    }

    // ============================================================
    // NOTIFICATION - Delegates to NotificationSystem
    // ============================================================

    function notify(message, type) {
        type = type || 'info';
        NotificationSystem.notify(message, type);
    }

    // ============================================================
    // STATE
    // ============================================================

    var _initialized = false;
    var _eventListeners = [];
    var _editId = null;

    // ============================================================
    // EVENT BINDING HELPERS
    // ============================================================

    function addEventListener(element, eventName, handler, options) {
        if (!element) return;

        element.addEventListener(eventName, handler, options || false);

        _eventListeners.push({
            element: element,
            eventName: eventName,
            handler: handler,
            options: options || false
        });
    }

    function removeAllEventListeners() {
        _eventListeners.forEach(function(item) {
            try {
                item.element.removeEventListener(item.eventName, item.handler, item.options);
            } catch (e) {
                // Ignore cleanup errors
            }
        });
        _eventListeners = [];
    }

    function delegate(selector, eventName, handler) {
        // Use document-level delegation for dynamically created elements
        function wrappedHandler(e) {
            var target = e.target.closest ? e.target.closest(selector) : null;
            if (!target) return;
            handler(e, target);
        }

        document.addEventListener(eventName, wrappedHandler);

        _eventListeners.push({
            element: document,
            eventName: eventName,
            handler: wrappedHandler,
            options: false
        });

        return wrappedHandler;
    }

    // ============================================================
    // INIT / DESTROY
    // ============================================================

    function init(container) {
        if (_initialized) {
            destroy();
        }

        if (!checkDependencies()) {
            console.warn('[SocialEvents] Dependencies not met, skipping initialization');
            return;
        }

        if (!container) {
            container = document.getElementById('tab-social');
        }
        if (!container) {
            console.warn('[SocialEvents] Container not found');
            return;
        }

        // Render the view
        SocialViews.renderSocialView(container);

        // Bind events
        bindAddRelationship();
        bindViewModeButtons();
        bindRelationshipForm();
        bindFilters();
        bindZoomControls();
        bindCharacterDetail();
        bindDeleteRelationship();
        bindEditRelationship();

        _initialized = true;
        _editId = null;
    }

    function destroy() {
        removeAllEventListeners();
        _initialized = false;
        _editId = null;
    }

    // ============================================================
    // ADD RELATIONSHIP
    // ============================================================

    function bindAddRelationship() {
        var addBtn = document.getElementById('add-relationship-btn');
        if (addBtn) {
            addEventListener(addBtn, 'click', function() {
                handleAddRelationship();
            });
        }
    }

    function handleAddRelationship(editId) {
        _editId = editId || null;

        var title = document.getElementById('relationship-form-title');
        var form = document.getElementById('relationship-form-inner');

        if (!title || !form) return;

        // Populate selectors
        SocialViews.populateFormSelectors();
        SocialViews.populateTypeSelectors();

        // Reset form
        form.reset();

        // Set mode
        if (_editId) {
            title.textContent = 'Edit Relationship';

            // Load existing data
            var rel = SocialQueries.getRelationshipById(_editId);
            if (rel) {
                document.getElementById('rel-char1').value = rel.character1 || '';
                document.getElementById('rel-char2').value = rel.character2 || '';
                document.getElementById('rel-type').value = rel.typeId || '';
                document.getElementById('rel-clarification').value = rel.clarification || '';
                document.getElementById('rel-start-year').value = rel.startYear || '';
                document.getElementById('rel-end-year').value = rel.endYear || '';
                document.getElementById('rel-notes').value = rel.notes || '';
            } else {
                notify('Relationship not found.', 'error');
                return;
            }
        } else {
            title.textContent = 'Add Relationship';
        }

        // Show modal
        var modal = document.getElementById('relationship-form-modal');
        if (modal) {
            Modal.showModal(modal);
        }
    }

    // ============================================================
    // RELATIONSHIP FORM
    // ============================================================

    function bindRelationshipForm() {
        // Form submit
        var form = document.getElementById('relationship-form-inner');
        if (form) {
            addEventListener(form, 'submit', function(e) {
                e.preventDefault();
                handleSaveRelationship();
            });
        }

        // Close button
        var closeBtn = document.getElementById('close-relationship-form');
        if (closeBtn) {
            addEventListener(closeBtn, 'click', function() {
                handleCloseRelationshipForm();
            });
        }

        // Cancel button
        var cancelBtn = document.getElementById('cancel-relationship-form');
        if (cancelBtn) {
            addEventListener(cancelBtn, 'click', function() {
                handleCloseRelationshipForm();
            });
        }

        // Outside click
        var modal = document.getElementById('relationship-form-modal');
        if (modal) {
            addEventListener(modal, 'click', function(e) {
                if (e.target === modal) {
                    handleCloseRelationshipForm();
                }
            });
        }
    }

    function handleSaveRelationship() {
        var char1 = document.getElementById('rel-char1').value;
        var char2 = document.getElementById('rel-char2').value;
        var typeId = document.getElementById('rel-type').value;
        var clarification = document.getElementById('rel-clarification').value.trim();
        var startYear = document.getElementById('rel-start-year').value;
        var endYear = document.getElementById('rel-end-year').value;
        var notes = document.getElementById('rel-notes').value.trim();

        // Basic validation
        if (!char1 || !char2 || !typeId) {
            notify('Please fill in all required fields.', 'error');
            return;
        }

        if (char1 === char2) {
            notify('Cannot create a relationship between the same character.', 'error');
            return;
        }

        var promise;

        if (_editId) {
            promise = SocialCore.updateRelationship(_editId, {
                character1: char1,
                character2: char2,
                typeId: typeId,
                clarification: clarification,
                startYear: startYear,
                endYear: endYear,
                notes: notes
            });
        } else {
            promise = SocialCore.createRelationship(
                char1, char2, typeId,
                startYear, endYear,
                clarification, notes
            );
        }

        promise.then(function(result) {
            if (result.success) {
                handleCloseRelationshipForm();
                refreshUI();
            } else {
                notify(result.message || 'Failed to save relationship.', 'error');
            }
        }).catch(function(err) {
            notify('An error occurred while saving.', 'error');
            console.error('[SocialEvents] Save error:', err);
        });
    }

    function handleCloseRelationshipForm() {
        var modal = document.getElementById('relationship-form-modal');
        if (modal) {
            Modal.closeModal(modal);
        }
        _editId = null;
    }

    // ============================================================
    // DELETE RELATIONSHIP
    // ============================================================

    function bindDeleteRelationship() {
        delegate('.delete-relationship', 'click', function(e, target) {
            var id = target.dataset.id;
            if (id) {
                handleDeleteRelationship(id);
            }
        });
    }

    function handleDeleteRelationship(id) {
        if (!id) return;

        var rel = SocialQueries.getRelationshipById(id);
        if (!rel) {
            notify('Relationship not found.', 'error');
            return;
        }

        var char1 = CharacterQueries.getCharacterById(rel.character1);
        var char2 = CharacterQueries.getCharacterById(rel.character2);
        var name1 = char1 ? CharacterQueries.getDisplayName(char1) : 'Unknown';
        var name2 = char2 ? CharacterQueries.getDisplayName(char2) : 'Unknown';
        var label = SocialQueries.getRelationshipTypeLabel(rel.typeId);

        if (!confirm('Delete the ' + label + ' relationship between ' + name1 + ' and ' + name2 + '?')) {
            return;
        }

        SocialCore.deleteRelationship(id).then(function(result) {
            if (result.success) {
                refreshUI();
                notify('Relationship deleted successfully!', 'success');
            } else {
                notify(result.message || 'Failed to delete relationship.', 'error');
            }
        }).catch(function(err) {
            notify('An error occurred while deleting.', 'error');
            console.error('[SocialEvents] Delete error:', err);
        });
    }

    // ============================================================
    // EDIT RELATIONSHIP
    // ============================================================

    function bindEditRelationship() {
        delegate('.edit-relationship', 'click', function(e, target) {
            var id = target.dataset.id;
            if (id) {
                handleEditRelationship(id);
            }
        });
    }

    function handleEditRelationship(id) {
        if (!id) return;

        var rel = SocialQueries.getRelationshipById(id);
        if (!rel) {
            notify('Relationship not found.', 'error');
            return;
        }

        handleAddRelationship(id);
    }

    // ============================================================
    // VIEW MODE
    // ============================================================

    function bindViewModeButtons() {
        var graphBtn = document.getElementById('view-graph-btn');
        if (graphBtn) {
            addEventListener(graphBtn, 'click', function() {
                handleViewModeChange('graph');
            });
        }

        var listBtn = document.getElementById('view-list-btn');
        if (listBtn) {
            addEventListener(listBtn, 'click', function() {
                handleViewModeChange('list');
            });
        }
    }

    function handleViewModeChange(mode) {
        if (mode === 'graph') {
            SocialGraph.setGraphVisible(true);
            SocialGraph.renderGraph();
        } else {
            SocialGraph.setGraphVisible(false);
            SocialViews.renderRelationships();
        }
    }

    // ============================================================
    // FILTERS
    // ============================================================

    function bindFilters() {
        var charFilter = document.getElementById('social-character-filter');
        if (charFilter) {
            addEventListener(charFilter, 'change', function() {
                SocialViews.renderRelationships();
                if (SocialGraph.isGraphVisible()) {
                    SocialGraph.renderGraph();
                }
            });
        }

        var typeFilter = document.getElementById('social-type-filter');
        if (typeFilter) {
            addEventListener(typeFilter, 'change', function() {
                SocialViews.renderRelationships();
                if (SocialGraph.isGraphVisible()) {
                    SocialGraph.renderGraph();
                }
            });
        }

        var clearBtn = document.getElementById('clear-social-filters');
        if (clearBtn) {
            addEventListener(clearBtn, 'click', function() {
                var charFilter = document.getElementById('social-character-filter');
                var typeFilter = document.getElementById('social-type-filter');

                if (charFilter) charFilter.value = 'all';
                if (typeFilter) typeFilter.value = 'all';

                SocialViews.renderRelationships();
                if (SocialGraph.isGraphVisible()) {
                    SocialGraph.renderGraph();
                }
            });
        }
    }

    // ============================================================
    // ZOOM CONTROLS
    // ============================================================

    function bindZoomControls() {
        var zoomInBtn = document.getElementById('zoom-in-btn');
        if (zoomInBtn) {
            addEventListener(zoomInBtn, 'click', function() {
                SocialGraph.zoomIn();
            });
        }

        var zoomOutBtn = document.getElementById('zoom-out-btn');
        if (zoomOutBtn) {
            addEventListener(zoomOutBtn, 'click', function() {
                SocialGraph.zoomOut();
            });
        }

        var resetZoomBtn = document.getElementById('reset-zoom-btn');
        if (resetZoomBtn) {
            addEventListener(resetZoomBtn, 'click', function() {
                SocialGraph.resetZoom();
            });
        }
    }

    // ============================================================
    // CHARACTER DETAIL
    // ============================================================

    function bindCharacterDetail() {
        // Graph node clicks (delegated)
        delegate('.graph-node', 'click', function(e, target) {
            var id = target.dataset.id;
            if (id) {
                handleGraphNodeClick(id);
            }
        });

        // Close detail
        var closeBtn = document.getElementById('close-char-detail');
        if (closeBtn) {
            addEventListener(closeBtn, 'click', function() {
                handleCharacterDetailClose();
            });
        }

        // Outside click
        var modal = document.getElementById('character-detail-modal');
        if (modal) {
            addEventListener(modal, 'click', function(e) {
                if (e.target === modal) {
                    handleCharacterDetailClose();
                }
            });
        }

        // View all relationships button (delegated)
        delegate('#view-char-relationships', 'click', function(e, target) {
            var id = target.dataset.id;
            if (id) {
                handleViewCharacterRelationships(id);
            }
        });
    }

    function handleGraphNodeClick(charId) {
        if (!charId) return;

        var char = CharacterQueries.getCharacterById(charId);
        if (!char) {
            notify('Character not found.', 'error');
            return;
        }

        var modal = document.getElementById('character-detail-modal');
        if (!modal) return;

        var content = document.getElementById('char-detail-content');
        if (!content) return;

        // Render content
        SocialViews.renderCharacterDetailContent(charId, content);

        // Show modal
        Modal.showModal(modal);
    }

    function handleCharacterDetailClose() {
        var modal = document.getElementById('character-detail-modal');
        if (modal) {
            Modal.closeModal(modal);
        }
    }

    function handleViewCharacterRelationships(charId) {
        if (!charId) return;

        // Close detail
        handleCharacterDetailClose();

        // Set filter to this character
        var filter = document.getElementById('social-character-filter');
        if (filter) {
            filter.value = charId;
            SocialViews.renderRelationships();
            if (SocialGraph.isGraphVisible()) {
                SocialGraph.renderGraph();
            }
        }
    }

    // ============================================================
    // UI REFRESH
    // ============================================================

    function refreshUI() {
        SocialViews.renderRelationships();
        if (SocialGraph.isGraphVisible()) {
            SocialGraph.renderGraph();
        }
        SocialGraph.updateLegend();
    }

    // ============================================================
    // RESIZE HANDLING
    // ============================================================

    function bindResize() {
        var resizeHandler = function() {
            if (SocialGraph.isGraphVisible()) {
                SocialGraph.handleResize();
            }
        };

        // Debounced resize handler
        var timeoutId = null;

        var debouncedHandler = function() {
            if (timeoutId) {
                clearTimeout(timeoutId);
                timeoutId = null;
            }
            timeoutId = setTimeout(resizeHandler, 200);
        };

        addEventListener(window, 'resize', debouncedHandler);
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.SocialEvents = {
        init: init,
        destroy: destroy,

        // Handlers (exposed for testing)
        handleAddRelationship: handleAddRelationship,
        handleSaveRelationship: handleSaveRelationship,
        handleDeleteRelationship: handleDeleteRelationship,
        handleEditRelationship: handleEditRelationship,
        handleViewModeChange: handleViewModeChange,
        handleGraphNodeClick: handleGraphNodeClick,
        handleCharacterDetailClose: handleCharacterDetailClose,

        // Refresh
        refreshUI: refreshUI
    };

    // ============================================================
    // AUTO-INIT
    // ============================================================

    function autoInit() {
        if (document.readyState === 'complete' || document.readyState === 'interactive') {
            var container = document.getElementById('tab-social');
            if (container) {
                init(container);
            }
        } else {
            document.addEventListener('DOMContentLoaded', function() {
                var container = document.getElementById('tab-social');
                if (container) {
                    init(container);
                }
            });
        }
    }

    autoInit();

})();