/**
 * js/modules/academia/academia-events.js - Academia Events
 * Path: js/modules/academia/academia-events.js
 * 
 * This module is responsible for UI event binding for the academia module.
 * 
 * IMPORTANT:
 *   - This module binds events AFTER the DOM is rendered
 *   - Uses event delegation where possible for dynamic elements
 *   - All mutations delegate to AcademiaCore
 *   - Safe event binding with proper cleanup
 *   - No inline event handlers in HTML
 *   - Can be re-initialized after DOM replacement
 *   - No direct mutation of window.data
 *   - USES CharacterList for character list rendering
 *   - USES AcademiaDetail for detail rendering
 *   - USES NotificationSystem for notifications
 *   - USES DomUtils for DOM operations
 * 
 * LIFECYCLE:
 *   - init(container) - Binds events to the current DOM
 *   - destroy() - Removes all event listeners and resets state
 *   - Re-initialization is supported for dynamic DOM replacement
 * 
 * DEPENDENCIES:
 *   - window.AcademiaCore (from academia-core.js)
 *   - window.AcademiaQueries (from academia-queries.js)
 *   - window.AcademiaDetail (from academia-detail.js)
 *   - window.CharacterList (from character-list.js)
 *   - window.NotificationSystem (from notification.js)
 *   - window.DomUtils (from dom-utils.js)
 *   - window.selectAcademiaCharacter (from academia/index.js)
 */

(function() {
    'use strict';

    // Guard against duplicate script loading
    if (window.__academiaEventsLoaded) {
        return;
    }

    // ============================================================
    // DEPENDENCY IMPORTS - NO FALLBACKS
    // ============================================================

    var AcademiaCore = window.AcademiaCore;
    var AcademiaQueries = window.AcademiaQueries;
    var AcademiaDetail = window.AcademiaDetail;
    var CharacterList = window.CharacterList;
    var NotificationSystem = window.NotificationSystem;
    var DomUtils = window.DomUtils;
    var selectAcademiaCharacter = window.selectAcademiaCharacter;

    // ============================================================
    // DEPENDENCY CHECK
    // ============================================================

    function checkDependencies() {
        var missing = [];

        if (!AcademiaCore || typeof AcademiaCore.saveGrades !== 'function') {
            missing.push('AcademiaCore.saveGrades');
        }

        if (!AcademiaQueries || typeof AcademiaQueries.getStudents !== 'function') {
            missing.push('AcademiaQueries.getStudents');
        }

        if (!AcademiaDetail || typeof AcademiaDetail.show !== 'function') {
            missing.push('AcademiaDetail.show');
        }

        if (!CharacterList || typeof CharacterList.render !== 'function') {
            missing.push('CharacterList.render');
        }

        if (!NotificationSystem || typeof NotificationSystem.notify !== 'function') {
            missing.push('NotificationSystem.notify');
        }

        if (!DomUtils || typeof DomUtils.escapeHtml !== 'function') {
            missing.push('DomUtils.escapeHtml');
        }

        if (typeof selectAcademiaCharacter !== 'function') {
            missing.push('selectAcademiaCharacter');
        }

        if (missing.length > 0) {
            console.warn('AcademiaEvents: Missing dependencies:', missing.join(', '));
            return false;
        }

        return true;
    }

    if (!checkDependencies()) {
        return;
    }

    window.__academiaEventsLoaded = true;

    // ============================================================
    // NOTIFICATION - Uses NotificationSystem (SINGLE SOURCE OF TRUTH)
    // ============================================================

    function showNotification(message, type) {
        type = type || 'info';
        NotificationSystem.notify(message, type);
    }

    // ============================================================
    // SAFE EVENT BINDING WITH CLEANUP
    // ============================================================

    var _eventListeners = [];

    function addSafeEventListener(element, eventName, handler, options) {
        if (!element) {
            return;
        }
        element.addEventListener(eventName, handler, options || false);
        _eventListeners.push({
            element: element,
            eventName: eventName,
            handler: handler,
            options: options || false
        });
    }

    function removeAllEventListeners() {
        for (var i = 0; i < _eventListeners.length; i++) {
            var item = _eventListeners[i];
            try {
                item.element.removeEventListener(item.eventName, item.handler, item.options);
            } catch (e) {
                // Ignore errors during cleanup
            }
        }
        _eventListeners = [];
    }

    // ============================================================
    // REFRESH HELPERS
    // ============================================================

    function refreshDetail() {
        var container = document.getElementById('academia-detail-container');
        if (container && AcademiaDetail && typeof AcademiaDetail.getState === 'function') {
            var state = AcademiaDetail.getState();
            if (state && state.characterId) {
                AcademiaDetail.show(state.characterId);
            }
        }
    }

    function refreshList() {
        if (CharacterList && typeof CharacterList.render === 'function') {
            CharacterList.render();
        }
    }

    function refreshAll() {
        refreshList();
        refreshDetail();
    }

    // ============================================================
    // MAIN INITIALIZATION - Supports re-initialization
    // ============================================================

    function init(container) {
        if (!container) {
            container = document.getElementById('tab-academia');
        }
        if (!container) {
            console.warn('AcademiaEvents: Container not found');
            return;
        }

        // Remove existing listeners before binding new ones
        removeAllEventListeners();

        // Bind all events
        bindCharacterList(container);
        bindRefreshButton(container);
        bindFilterControls(container);
        bindGradeEvents(container);
        bindRankingEvents(container);

        // Bind detail-specific events after detail is rendered
        bindDetailEvents(container);
    }

    // ============================================================
    // DESTROY - Clean up for re-initialization
    // ============================================================

    function destroy() {
        removeAllEventListeners();
    }

    // ============================================================
    // EVENT BINDING - Character List (Event Delegation)
    // ============================================================

    function bindCharacterList(container) {
        var listContainer = document.getElementById('characters-container');
        if (!listContainer) {
            return;
        }

        addSafeEventListener(listContainer, 'click', function(e) {
            var item = e.target.closest ? e.target.closest('.char-list-item') : null;
            if (!item) {
                return;
            }
            if (!listContainer.contains(item)) {
                return;
            }

            var id = item.dataset.id;
            if (!id) {
                return;
            }

            // Update state and detail
            if (typeof selectAcademiaCharacter === 'function') {
                selectAcademiaCharacter(id);
            }
        });
    }

    // ============================================================
    // EVENT BINDING - Refresh Button
    // ============================================================

    function bindRefreshButton(container) {
        var refreshBtn = document.getElementById('academia-refresh-btn');
        if (!refreshBtn) {
            return;
        }

        addSafeEventListener(refreshBtn, 'click', function() {
            refreshAll();
            showNotification('Refreshed', 'info');
        });
    }

    // ============================================================
    // EVENT BINDING - Filter Controls
    // ============================================================

    function bindFilterControls(container) {
        // Name filter
        var nameFilter = document.getElementById('char-name-filter');
        if (nameFilter) {
            addSafeEventListener(nameFilter, 'input', function() {
                if (CharacterList && typeof CharacterList.render === 'function') {
                    CharacterList.render();
                }
            });
        }

        // Class filter
        var classFilter = document.getElementById('char-class-filter');
        if (classFilter) {
            addSafeEventListener(classFilter, 'change', function() {
                if (CharacterList && typeof CharacterList.render === 'function') {
                    CharacterList.render();
                }
            });
        }

        // Hide deceased
        var hideDeceased = document.getElementById('hide-deceased');
        if (hideDeceased) {
            addSafeEventListener(hideDeceased, 'change', function() {
                if (CharacterList && typeof CharacterList.render === 'function') {
                    CharacterList.render();
                }
            });
        }

        // Hide eliminated
        var hideEliminated = document.getElementById('hide-eliminated');
        if (hideEliminated) {
            addSafeEventListener(hideEliminated, 'change', function() {
                if (CharacterList && typeof CharacterList.render === 'function') {
                    CharacterList.render();
                }
            });
        }

        // Clear filter
        var clearFilter = document.getElementById('clear-char-filter');
        if (clearFilter) {
            addSafeEventListener(clearFilter, 'click', function() {
                var nameEl = document.getElementById('char-name-filter');
                var classEl = document.getElementById('char-class-filter');
                var hideDeadEl = document.getElementById('hide-deceased');
                var hideElimEl = document.getElementById('hide-eliminated');

                if (nameEl) {
                    nameEl.value = '';
                }
                if (classEl) {
                    classEl.value = 'all';
                }
                if (hideDeadEl) {
                    hideDeadEl.checked = true;
                }
                if (hideElimEl) {
                    hideElimEl.checked = true;
                }

                if (CharacterList && typeof CharacterList.render === 'function') {
                    CharacterList.render();
                }
            });
        }
    }

    // ============================================================
    // EVENT BINDING - Detail Tab Events (Delegation)
    // ============================================================

    function bindDetailEvents(container) {
        var detailContainer = document.getElementById('academia-detail-container');
        if (!detailContainer) {
            return;
        }

        // Tab switching
        addSafeEventListener(detailContainer, 'click', function(e) {
            var tabBtn = e.target.closest ? e.target.closest('.tab-btn') : null;
            if (!tabBtn) {
                return;
            }
            if (!detailContainer.contains(tabBtn)) {
                return;
            }

            var tab = tabBtn.dataset.tab;
            if (!tab) {
                return;
            }

            // Update active tab
            var allBtns = detailContainer.querySelectorAll('.tab-btn');
            for (var i = 0; i < allBtns.length; i++) {
                allBtns[i].classList.remove('active');
            }
            tabBtn.classList.add('active');

            // Get current character
            var state = AcademiaDetail.getState ? AcademiaDetail.getState() : null;
            var characterId = state ? state.characterId : null;

            if (characterId && AcademiaDetail && typeof AcademiaDetail.switchTab === 'function') {
                AcademiaDetail.switchTab(tab, characterId);
            }
        });
    }

    // ============================================================
    // EVENT BINDING - Grade Events (Delegation)
    // ============================================================

    function bindGradeEvents(container) {
        var detailContainer = document.getElementById('academia-detail-container');
        if (!detailContainer) {
            return;
        }

        // Save grades
        addSafeEventListener(detailContainer, 'click', function(e) {
            var saveBtn = e.target.closest ? e.target.closest('#save-grades-btn') : null;
            if (!saveBtn) {
                return;
            }
            if (!detailContainer.contains(saveBtn)) {
                return;
            }

            // Get current character and week
            var state = AcademiaDetail.getState ? AcademiaDetail.getState() : null;
            var characterId = state ? state.characterId : null;
            var week = state ? state.week || 1 : 1;

            if (!characterId) {
                showNotification('No character selected.', 'error');
                return;
            }

            saveGrades(characterId, week, detailContainer);
        });

        // Grade input live preview
        addSafeEventListener(detailContainer, 'input', function(e) {
            var input = e.target.closest ? e.target.closest('.grade-input') : null;
            if (!input) {
                return;
            }
            if (!detailContainer.contains(input)) {
                return;
            }

            updateGradePreview(input);
        });

        // Week navigation
        addSafeEventListener(detailContainer, 'click', function(e) {
            var prevBtn = e.target.closest ? e.target.closest('#prev-grade-week') : null;
            var nextBtn = e.target.closest ? e.target.closest('#next-grade-week') : null;

            if (!prevBtn && !nextBtn) {
                return;
            }
            if (!detailContainer.contains(prevBtn || nextBtn)) {
                return;
            }

            var state = AcademiaDetail.getState ? AcademiaDetail.getState() : null;
            var characterId = state ? state.characterId : null;
            var currentWeek = state ? state.week || 1 : 1;

            if (!characterId) {
                showNotification('No character selected.', 'error');
                return;
            }

            var newWeek = currentWeek;
            if (prevBtn) {
                newWeek = Math.max(1, currentWeek - 1);
            } else if (nextBtn) {
                newWeek = Math.min(52, currentWeek + 1);
            }

            if (newWeek !== currentWeek) {
                if (AcademiaDetail && typeof AcademiaDetail.setWeek === 'function') {
                    AcademiaDetail.setWeek(newWeek);
                }
                // Re-render grades tab
                if (AcademiaDetail && typeof AcademiaDetail.switchTab === 'function') {
                    AcademiaDetail.switchTab('grades', characterId);
                }
            }
        });
    }

    // ============================================================
    // GRADE HELPERS
    // ============================================================

    function updateGradePreview(input) {
        var row = input.closest('tr');
        if (!row) {
            return;
        }

        var disciplineId = input.dataset.discipline;
        var value = input.value.trim();
        var letterEl = row.querySelector('.grade-letter');
        var weightedEl = row.querySelector('.weighted-score');

        if (!disciplineId) {
            return;
        }

        var discipline = AcademiaQueries.getDiscipline(disciplineId);
        if (!discipline) {
            return;
        }

        if (value !== '' && !isNaN(Number(value))) {
            var numericScore = Number(value);
            if (numericScore >= 0 && numericScore <= 100) {
                var letter = AcademiaQueries.getGradeLetter(discipline, numericScore);
                if (letterEl) {
                    letterEl.textContent = letter || '--';
                }
                if (weightedEl && discipline.weight) {
                    var weighted = numericScore * Number(discipline.weight);
                    weightedEl.textContent = weighted.toFixed(1);
                }
            }
        } else if (value === '') {
            if (letterEl) {
                letterEl.textContent = '--';
            }
            if (weightedEl) {
                weightedEl.textContent = '--';
            }
        }
    }

    function saveGrades(studentId, week, container) {
        var grades = {};
        var hasChanges = false;
        var invalidInputs = [];

        var inputs = container.querySelectorAll('.grade-input:not([disabled])');
        for (var i = 0; i < inputs.length; i++) {
            var input = inputs[i];
            var disciplineId = input.dataset.discipline;
            var originalValue = input.dataset.original || '';
            var currentValue = input.value.trim();

            // Skip if no change
            if (currentValue === originalValue) {
                continue;
            }

            if (currentValue === '') {
                grades[disciplineId] = null;
                hasChanges = true;
                continue;
            }

            var numericValue = Number(currentValue);
            if (!isFinite(numericValue) || numericValue < 0 || numericValue > 100) {
                invalidInputs.push(disciplineId);
                continue;
            }

            grades[disciplineId] = numericValue;
            hasChanges = true;
        }

        if (invalidInputs.length > 0) {
            var disciplineNames = invalidInputs.map(function(id) {
                var d = AcademiaQueries.getDiscipline(id);
                return d ? d.name : id;
            });
            showNotification('Invalid scores for: ' + disciplineNames.join(', ') + '. Please enter values between 0 and 100.', 'error');
            return;
        }

        if (!hasChanges) {
            showNotification('No changes to save.', 'info');
            return;
        }

        var result = AcademiaCore.saveGrades(studentId, week, grades);

        if (!result || !result.success) {
            showNotification(result && result.message ? result.message : 'Failed to save grades.', 'error');
            return;
        }

        showNotification('Grades saved successfully.', 'success');

        // Refresh detail to show updated data
        if (AcademiaDetail && typeof AcademiaDetail.show === 'function') {
            AcademiaDetail.show(studentId);
        }

        // Persist
        if (typeof window.saveData === 'function') {
            window.saveData().catch(function() {
                showNotification('Grades saved in memory, but persistence failed.', 'error');
            });
        }
    }

    // ============================================================
    // EVENT BINDING - Ranking Events (Delegation)
    // ============================================================

    function bindRankingEvents(container) {
        var detailContainer = document.getElementById('academia-detail-container');
        if (!detailContainer) {
            return;
        }

        // Auto-rank button
        addSafeEventListener(detailContainer, 'click', function(e) {
            var autoBtn = e.target.closest ? e.target.closest('#auto-rank-btn') : null;
            if (!autoBtn) {
                return;
            }
            if (!detailContainer.contains(autoBtn)) {
                return;
            }

            var state = AcademiaDetail.getState ? AcademiaDetail.getState() : null;
            var week = state ? state.week || 1 : 1;

            autoGenerateRankings(week, detailContainer);
        });

        // Rank input change
        addSafeEventListener(detailContainer, 'change', function(e) {
            var input = e.target.closest ? e.target.closest('.rank-input') : null;
            if (!input) {
                return;
            }
            if (!detailContainer.contains(input)) {
                return;
            }

            var studentId = input.dataset.student;
            var newRank = parseInt(input.value, 10);
            var maxRank = parseInt(input.max, 10);

            if (!studentId || isNaN(newRank) || newRank < 1 || newRank > maxRank) {
                showNotification('Please enter a valid rank between 1 and ' + maxRank, 'error');
                input.value = input.defaultValue;
                return;
            }

            updateStudentRank(studentId, newRank, detailContainer);
        });

        // Week navigation
        addSafeEventListener(detailContainer, 'click', function(e) {
            var prevBtn = e.target.closest ? e.target.closest('#prev-rank-week') : null;
            var nextBtn = e.target.closest ? e.target.closest('#next-rank-week') : null;

            if (!prevBtn && !nextBtn) {
                return;
            }
            if (!detailContainer.contains(prevBtn || nextBtn)) {
                return;
            }

            var state = AcademiaDetail.getState ? AcademiaDetail.getState() : null;
            var characterId = state ? state.characterId : null;
            var currentWeek = state ? state.week || 1 : 1;

            if (!characterId) {
                showNotification('No character selected.', 'error');
                return;
            }

            var newWeek = currentWeek;
            if (prevBtn) {
                newWeek = Math.max(1, currentWeek - 1);
            } else if (nextBtn) {
                newWeek = Math.min(52, currentWeek + 1);
            }

            if (newWeek !== currentWeek) {
                if (AcademiaDetail && typeof AcademiaDetail.setWeek === 'function') {
                    AcademiaDetail.setWeek(newWeek);
                }
                if (AcademiaDetail && typeof AcademiaDetail.switchTab === 'function') {
                    AcademiaDetail.switchTab('ranking', characterId);
                }
            }
        });
    }

    // ============================================================
    // RANKING HELPERS
    // ============================================================

    function autoGenerateRankings(week, container) {
        if (!confirm('Auto-generate rankings for week ' + week + ' from grade data?')) {
            return;
        }

        var result = AcademiaCore.autoGenerateRankings(week);

        if (!result || !result.success) {
            showNotification(result && result.message ? result.message : 'Failed to auto-generate rankings.', 'error');
            return;
        }

        var count = result.count || 0;
        showNotification('Auto-generated rankings for week ' + week + ' (' + count + ' students ranked).', 'success');

        // Refresh ranking tab
        var state = AcademiaDetail.getState ? AcademiaDetail.getState() : null;
        var characterId = state ? state.characterId : null;
        if (characterId && AcademiaDetail && typeof AcademiaDetail.switchTab === 'function') {
            AcademiaDetail.switchTab('ranking', characterId);
        }

        // Persist
        if (typeof window.saveData === 'function') {
            window.saveData().catch(function() {
                showNotification('Rankings generated in memory, but persistence failed.', 'error');
            });
        }
    }

    function updateStudentRank(studentId, newRank, container) {
        var state = AcademiaDetail.getState ? AcademiaDetail.getState() : null;
        var week = state ? state.week || 1 : 1;

        var result = AcademiaCore.updateStudentRank(week, studentId, newRank);

        if (!result || !result.success) {
            showNotification(result && result.message ? result.message : 'Failed to update rank.', 'error');
            return;
        }

        showNotification('Rank updated successfully.', 'success');

        // Refresh ranking tab
        var characterId = state ? state.characterId : null;
        if (characterId && AcademiaDetail && typeof AcademiaDetail.switchTab === 'function') {
            AcademiaDetail.switchTab('ranking', characterId);
        }

        // Persist
        if (typeof window.saveData === 'function') {
            window.saveData().catch(function() {
                showNotification('Rank updated in memory, but persistence failed.', 'error');
            });
        }
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.AcademiaEvents = {
        init: init,
        destroy: destroy,
        refreshAll: refreshAll,
        refreshList: refreshList,
        refreshDetail: refreshDetail
    };

})();
