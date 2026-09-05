/**
 * utils/notification.js - Notification System
 * Toast/notification system for the application
 * Path: js/utils/notification.js
 * 
 * This module provides:
 *   - Toast notifications with auto-dismiss
 *   - Notification types (success, error, warning, info)
 *   - Notification queue management
 *   - Persistent notification support
 *   - Proper notification identity (dismiss by ID, not message text)
 *   - Reliable onDismiss callbacks (called exactly once)
 * 
 * IMPORTANT:
 *   - Owns notification UI lifecycle
 *   - Does not mutate application/domain data
 *   - Does not persist notifications
 *   - Has no domain knowledge
 *   - No DOM dependencies (direct DOM manipulation only)
 *   - Uses IdUtils for notification IDs (SINGLE SOURCE OF TRUTH)
 * 
 * DEPENDENCIES:
 *   - window.IdUtils (for notification IDs)
 *   - DOM APIs (document, window)
 * 
 * USAGE:
 *   // Simple toast
 *   var notif = NotificationSystem.notify('Hello world!');
 * 
 *   // With type and callback
 *   var notif = NotificationSystem.notify('Saved!', 'success', 3000, function() {
 *       console.log('Notification dismissed');
 *   });
 * 
 *   // Dismiss manually
 *   notif.dismiss();
 * 
 *   // Persistent (must be dismissed manually)
 *   var notif = NotificationSystem.notify('Important', 'warning', 0);
 *   notif.dismiss(); // Must be called explicitly
 */

(function() {
    'use strict';

    // Guard against duplicate loading
    if (window.__notificationLoaded) {
        return;
    }
    window.__notificationLoaded = true;

    // ============================================================
    // DEPENDENCY IMPORTS
    // ============================================================

    var IdUtils = window.IdUtils;

    // ============================================================
    // CONSTANTS
    // ============================================================

    var DEFAULT_DURATION = 3000;
    var _maxNotifications = 5;
    var ANIMATION_DURATION = 300;

    var TYPES = {
        success: {
            icon: '✓',
            className: 'notification-success',
            defaultDuration: 3000,
            ariaLabel: 'Success'
        },
        error: {
            icon: '✕',
            className: 'notification-error',
            defaultDuration: 5000,
            ariaLabel: 'Error'
        },
        warning: {
            icon: '⚠',
            className: 'notification-warning',
            defaultDuration: 4000,
            ariaLabel: 'Warning'
        },
        info: {
            icon: 'ℹ',
            className: 'notification-info',
            defaultDuration: 3000,
            ariaLabel: 'Information'
        }
    };

    // ============================================================
    // STATE
    // ============================================================

    var _container = null;
    var _queue = [];
    var _activeNotifications = [];
    var _nextId = 1;

    // ============================================================
    // NOTIFICATION IDENTITY
    // ============================================================

    function generateNotificationId() {
        if (IdUtils && typeof IdUtils.generateId === 'function') {
            return IdUtils.generateId('notif');
        }
        // Emergency fallback (should never be reached)
        return 'notif_' + (_nextId++);
    }

    // ============================================================
    // CONTAINER MANAGEMENT
    // ============================================================

    function getContainer() {
        if (!_container) {
            _container = document.getElementById('notification-container');
            if (!_container) {
                _container = document.createElement('div');
                _container.id = 'notification-container';
                _container.className = 'notification-container';
                document.body.appendChild(_container);
            }
        }
        return _container;
    }

    function ensureContainerStyles() {
        var style = document.getElementById('notification-styles');
        if (style) return;

        style = document.createElement('style');
        style.id = 'notification-styles';
        style.textContent = `
            .notification-container {
                position: fixed;
                top: 20px;
                right: 20px;
                z-index: 10000;
                display: flex;
                flex-direction: column;
                gap: 8px;
                max-width: 400px;
                width: 100%;
                pointer-events: none;
            }

            .notification-container .notification {
                pointer-events: auto;
                padding: 12px 16px;
                border-radius: 8px;
                background: var(--panel, #2d2d2d);
                color: var(--text, #e0e0e0);
                border: 1px solid var(--border, #444);
                box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
                display: flex;
                align-items: flex-start;
                gap: 10px;
                opacity: 0;
                transform: translateX(20px);
                transition: opacity 0.3s ease, transform 0.3s ease;
                max-width: 400px;
                min-width: 200px;
            }

            .notification-container .notification.visible {
                opacity: 1;
                transform: translateX(0);
            }

            .notification-container .notification.hiding {
                opacity: 0;
                transform: translateX(20px);
            }

            .notification-container .notification .notification-icon {
                font-size: 18px;
                line-height: 1.4;
                flex-shrink: 0;
                width: 24px;
                text-align: center;
            }

            .notification-container .notification .notification-content {
                flex: 1;
                font-size: 14px;
                line-height: 1.4;
                word-wrap: break-word;
            }

            .notification-container .notification .notification-close {
                background: none;
                border: none;
                color: var(--text-dim, #888);
                cursor: pointer;
                font-size: 16px;
                padding: 0 4px;
                line-height: 1.4;
                flex-shrink: 0;
                opacity: 0.6;
                transition: opacity 0.2s;
            }

            .notification-container .notification .notification-close:hover {
                opacity: 1;
            }

            .notification-container .notification-success {
                border-left: 4px solid var(--accent, #4CAF50);
                background: var(--panel, #2d2d2d);
            }

            .notification-container .notification-success .notification-icon {
                color: var(--accent, #4CAF50);
            }

            .notification-container .notification-error {
                border-left: 4px solid var(--danger, #f44336);
                background: var(--panel, #2d2d2d);
            }

            .notification-container .notification-error .notification-icon {
                color: var(--danger, #f44336);
            }

            .notification-container .notification-warning {
                border-left: 4px solid var(--warning, #ff9800);
                background: var(--panel, #2d2d2d);
            }

            .notification-container .notification-warning .notification-icon {
                color: var(--warning, #ff9800);
            }

            .notification-container .notification-info {
                border-left: 4px solid var(--info, #2196F3);
                background: var(--panel, #2d2d2d);
            }

            .notification-container .notification-info .notification-icon {
                color: var(--info, #2196F3);
            }

            @media (max-width: 480px) {
                .notification-container {
                    top: 10px;
                    right: 10px;
                    left: 10px;
                    max-width: none;
                    width: auto;
                }

                .notification-container .notification {
                    max-width: none;
                    min-width: auto;
                }
            }
        `;
        document.head.appendChild(style);
    }

    // ============================================================
    // NOTIFICATION CREATION
    // ============================================================

    function createNotificationDOM(item) {
        var type = item.type || 'info';
        var duration = item.duration !== undefined ? item.duration : TYPES[type] ? TYPES[type].defaultDuration : DEFAULT_DURATION;
        var isPersistent = duration === 0;

        var typeConfig = TYPES[type] || TYPES.info;
        var notificationId = item.id;

        var notification = document.createElement('div');
        notification.className = 'notification ' + typeConfig.className;
        notification.role = 'alert';
        notification.setAttribute('aria-label', typeConfig.ariaLabel || 'Notification');
        notification.dataset.notificationId = notificationId;

        // Icon
        var icon = document.createElement('span');
        icon.className = 'notification-icon';
        icon.textContent = typeConfig.icon;
        notification.appendChild(icon);

        // Content
        var content = document.createElement('span');
        content.className = 'notification-content';
        content.textContent = item.message;
        notification.appendChild(content);

        // Close button
        var closeBtn = document.createElement('button');
        closeBtn.className = 'notification-close';
        closeBtn.setAttribute('aria-label', 'Dismiss notification');
        closeBtn.textContent = '×';
        closeBtn.addEventListener('click', function(e) {
            e.stopPropagation();
            dismissNotification(notificationId);
        });
        notification.appendChild(closeBtn);

        // Auto-dismiss
        var timer = null;
        if (!isPersistent) {
            timer = setTimeout(function() {
                dismissNotification(notificationId);
            }, duration);
        }

        notification._timer = timer;
        notification._dismissed = false;

        return notification;
    }

    // ============================================================
    // NOTIFICATION DISMISSAL
    // ============================================================

    function dismissNotification(notificationId) {
        // Find the notification by ID
        var notification = _activeNotifications.find(function(n) {
            return n.dataset && n.dataset.notificationId === notificationId;
        });

        if (!notification || notification._dismissed) {
            return;
        }

        // Mark as dismissed to prevent double dismissal
        notification._dismissed = true;

        // Clear timer
        if (notification._timer) {
            clearTimeout(notification._timer);
            notification._timer = null;
        }

        // Remove from active list
        var index = _activeNotifications.indexOf(notification);
        if (index !== -1) {
            _activeNotifications.splice(index, 1);
        }

        // Find the queue item and execute callback
        var queueIndex = _queue.findIndex(function(item) {
            return item.id === notificationId;
        });

        var onDismiss = null;
        if (queueIndex !== -1) {
            var item = _queue[queueIndex];
            onDismiss = item.onDismiss;
            // Remove from queue if it was still there
            if (queueIndex !== -1) {
                _queue.splice(queueIndex, 1);
            }
        }

        // Animate out
        notification.classList.remove('visible');
        notification.classList.add('hiding');

        setTimeout(function() {
            if (notification.parentNode) {
                notification.parentNode.removeChild(notification);
            }
            // Process queue
            processQueue();
        }, ANIMATION_DURATION);

        // Execute callback exactly once
        if (typeof onDismiss === 'function') {
            try {
                onDismiss();
            } catch (e) {
                // Ignore callback errors
            }
        }
    }

    // ============================================================
    // QUEUE MANAGEMENT
    // ============================================================

    function processQueue() {
        if (_activeNotifications.length >= _maxNotifications) {
            return;
        }

        if (_queue.length === 0) {
            return;
        }

        // Dequeue next notification
        var item = _queue.shift();
        var container = getContainer();

        // Create DOM notification
        var notification = createNotificationDOM(item);
        container.appendChild(notification);
        _activeNotifications.push(notification);

        // Trigger reflow for animation
        requestAnimationFrame(function() {
            notification.classList.add('visible');
        });

        // Process next if we have room
        if (_activeNotifications.length < _maxNotifications && _queue.length > 0) {
            // Small delay to prevent visual overlap issues
            setTimeout(processQueue, 50);
        }
    }

    function enqueue(item) {
        _queue.push(item);

        if (_activeNotifications.length < _maxNotifications) {
            processQueue();
        }
    }

    // ============================================================
    // PUBLIC API
    // ============================================================

    /**
     * Show a notification toast.
     * 
     * @param {string} message - The message to display
     * @param {string} type - 'success' | 'error' | 'warning' | 'info'
     * @param {number} duration - Duration in ms (0 = persistent)
     * @param {function} onDismiss - Callback when dismissed (called exactly once)
     * @returns {object} Notification handle with dismiss() method
     */
    function notify(message, type, duration, onDismiss) {
        if (!message) {
            console.warn('Notification: No message provided.');
            return null;
        }

        // Ensure container and styles exist
        ensureContainerStyles();
        getContainer();

        // Generate unique ID for this notification
        var id = generateNotificationId();

        var item = {
            id: id,
            message: String(message),
            type: type || 'info',
            duration: duration !== undefined ? duration : TYPES[type] ? TYPES[type].defaultDuration : DEFAULT_DURATION,
            onDismiss: onDismiss || null
        };

        enqueue(item);

        // Return handle with dismiss method
        return {
            id: id,
            dismiss: function() {
                dismissNotification(id);
            },
            isDismissed: function() {
                // Check if notification is still in queue or active
                var inQueue = _queue.some(function(q) { return q.id === id; });
                var inActive = _activeNotifications.some(function(n) {
                    return n.dataset && n.dataset.notificationId === id && !n._dismissed;
                });
                return !inQueue && !inActive;
            }
        };
    }

    /**
     * Show a success notification.
     */
    function notifySuccess(message, duration, onDismiss) {
        return notify(message, 'success', duration, onDismiss);
    }

    /**
     * Show an error notification.
     */
    function notifyError(message, duration, onDismiss) {
        return notify(message, 'error', duration, onDismiss);
    }

    /**
     * Show a warning notification.
     */
    function notifyWarning(message, duration, onDismiss) {
        return notify(message, 'warning', duration, onDismiss);
    }

    /**
     * Show an info notification.
     */
    function notifyInfo(message, duration, onDismiss) {
        return notify(message, 'info', duration, onDismiss);
    }

    /**
     * Clear all active notifications.
     */
    function clearNotifications() {
        // Clear queue
        var queuedItems = _queue.slice();
        _queue = [];

        // Dismiss all active notifications
        var activeCopy = _activeNotifications.slice();
        activeCopy.forEach(function(notification) {
            if (notification.dataset && notification.dataset.notificationId) {
                dismissNotification(notification.dataset.notificationId);
            }
        });

        // Call onDismiss for queued items that were cleared
        queuedItems.forEach(function(item) {
            if (typeof item.onDismiss === 'function') {
                try {
                    item.onDismiss();
                } catch (e) {
                    // Ignore callback errors
                }
            }
        });
    }

    /**
     * Get the number of active notifications.
     */
    function getNotificationCount() {
        return _activeNotifications.length + _queue.length;
    }

    /**
     * Get the notification container.
     */
    function getNotificationContainer() {
        return getContainer();
    }

    /**
     * Set the maximum number of simultaneous notifications.
     */
    function setMaxNotifications(max) {
        if (typeof max === 'number' && max > 0) {
            _maxNotifications = max;
        }
    }

    /**
     * Get the maximum number of simultaneous notifications.
     */
    function getMaxNotifications() {
        return _maxNotifications;
    }

    /**
     * Get the default duration for a notification type.
     */
    function getDefaultDuration(type) {
        var config = TYPES[type];
        return config ? config.defaultDuration : DEFAULT_DURATION;
    }

    // ============================================================
    // COMPATIBILITY WRAPPERS
    // ============================================================

    /**
     * Compatibility wrapper for window.showToast.
     * @deprecated Use NotificationSystem.notify() instead.
     */
    function showToast(message, type) {
        return notify(message, type || 'info');
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.NotificationSystem = {
        // Main API
        notify: notify,
        notifySuccess: notifySuccess,
        notifyError: notifyError,
        notifyWarning: notifyWarning,
        notifyInfo: notifyInfo,

        // Management
        clearNotifications: clearNotifications,
        getNotificationCount: getNotificationCount,
        getNotificationContainer: getNotificationContainer,
        setMaxNotifications: setMaxNotifications,
        getMaxNotifications: getMaxNotifications,
        getDefaultDuration: getDefaultDuration,

        // Compatibility
        showToast: showToast,

        // Constants (read-only)
        TYPES: Object.freeze(TYPES),
        DEFAULT_DURATION: DEFAULT_DURATION,
        get MAX_NOTIFICATIONS() { return _maxNotifications; }
    };

    // Global aliases for backward compatibility
    window.notify = notify;
    window.showToast = showToast;

    // Auto-init container
    if (document.readyState === 'complete' || document.readyState === 'interactive') {
        ensureContainerStyles();
        getContainer();
    } else {
        document.addEventListener('DOMContentLoaded', function() {
            ensureContainerStyles();
            getContainer();
        });
    }

})();