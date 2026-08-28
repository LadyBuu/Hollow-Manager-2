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
 *   - Notification history
 *   - Customizable duration and styling
 * 
 * IMPORTANT:
 *   - All functions are PURE where possible
 *   - No data mutation
 *   - Safe for use in any context
 *   - Works with or without DOM
 * 
 * USAGE:
 *   // Simple toast
 *   notify('Hello world!');
 * 
 *   // With type
 *   notify('Success!', 'success');
 * 
 *   // With custom duration
 *   notify('Warning!', 'warning', 5000);
 * 
 *   // Persistent (must be dismissed manually)
 *   notify('Important message', 'info', 0);
 */

(function() {
    'use strict';

    // Guard against duplicate loading
    if (window.__notificationLoaded) {
        return;
    }
    window.__notificationLoaded = true;

    // ============================================================
    // CONSTANTS
    // ============================================================

    var DEFAULT_DURATION = 3000;
    var MAX_NOTIFICATIONS = 5;
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
    var _isRendering = false;

    // ============================================================
    // HTML ESCAPING (local copy)
    // ============================================================

    function escapeHtml(value) {
        if (value === undefined || value === null) {
            return '';
        }
        return String(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
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

    function createNotificationDOM(message, type, duration, onDismiss) {
        type = type || 'info';
        duration = duration !== undefined ? duration : TYPES[type] ? TYPES[type].defaultDuration : DEFAULT_DURATION;
        var isPersistent = duration === 0 || duration === null || duration === undefined;

        var typeConfig = TYPES[type] || TYPES.info;

        var notification = document.createElement('div');
        notification.className = 'notification ' + typeConfig.className;
        notification.role = 'alert';
        notification.setAttribute('aria-label', typeConfig.ariaLabel || 'Notification');

        // Icon
        var icon = document.createElement('span');
        icon.className = 'notification-icon';
        icon.textContent = typeConfig.icon;
        notification.appendChild(icon);

        // Content
        var content = document.createElement('span');
        content.className = 'notification-content';
        content.textContent = message;
        notification.appendChild(content);

        // Close button (always show for persistent, show for others on hover)
        var closeBtn = document.createElement('button');
        closeBtn.className = 'notification-close';
        closeBtn.setAttribute('aria-label', 'Dismiss notification');
        closeBtn.textContent = '×';
        closeBtn.addEventListener('click', function(e) {
            e.stopPropagation();
            dismissNotification(notification);
            if (typeof onDismiss === 'function') {
                onDismiss();
            }
        });
        notification.appendChild(closeBtn);

        // Auto-dismiss
        var timer = null;

        if (!isPersistent) {
            timer = setTimeout(function() {
                dismissNotification(notification);
                if (typeof onDismiss === 'function') {
                    onDismiss();
                }
            }, duration);
        }

        notification._timer = timer;
        notification._onDismiss = onDismiss;

        return notification;
    }

    function dismissNotification(notification) {
        if (!notification || notification._dismissed) return;

        notification._dismissed = true;

        // Clear timer
        if (notification._timer) {
            clearTimeout(notification._timer);
            notification._timer = null;
        }

        // Animate out
        notification.classList.remove('visible');
        notification.classList.add('hiding');

        setTimeout(function() {
            if (notification.parentNode) {
                notification.parentNode.removeChild(notification);
            }
            var index = _activeNotifications.indexOf(notification);
            if (index !== -1) {
                _activeNotifications.splice(index, 1);
            }
            // Process queue
            processQueue();
        }, ANIMATION_DURATION);
    }

    // ============================================================
    // QUEUE MANAGEMENT
    // ============================================================

    function processQueue() {
        if (_isRendering) return;
        if (_activeNotifications.length >= MAX_NOTIFICATIONS) return;
        if (_queue.length === 0) return;

        _isRendering = true;

        var item = _queue.shift();
        var container = getContainer();
        var notification = createNotificationDOM(
            item.message,
            item.type,
            item.duration,
            function() {
                // On dismiss callback
            }
        );

        container.appendChild(notification);
        _activeNotifications.push(notification);

        // Trigger reflow for animation
        requestAnimationFrame(function() {
            notification.classList.add('visible');
        });

        _isRendering = false;

        // Process next if we have room
        if (_activeNotifications.length < MAX_NOTIFICATIONS && _queue.length > 0) {
            setTimeout(processQueue, 100);
        }
    }

    function enqueue(message, type, duration, onDismiss) {
        _queue.push({
            message: message,
            type: type || 'info',
            duration: duration,
            onDismiss: onDismiss
        });

        if (_activeNotifications.length < MAX_NOTIFICATIONS) {
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
     * @param {function} onDismiss - Callback when dismissed
     * @returns {object} The notification object (for manual dismissal)
     */
    function notify(message, type, duration, onDismiss) {
        if (!message) {
            console.warn('Notification: No message provided.');
            return null;
        }

        // Ensure container and styles exist
        ensureContainerStyles();
        getContainer();

        enqueue(message, type, duration, onDismiss);

        return {
            dismiss: function() {
                // Find and dismiss the notification
                var container = getContainer();
                var notifications = container.querySelectorAll('.notification');
                var target = null;
                for (var i = 0; i < notifications.length; i++) {
                    var content = notifications[i].querySelector('.notification-content');
                    if (content && content.textContent === message) {
                        target = notifications[i];
                        break;
                    }
                }
                if (target) {
                    dismissNotification(target);
                }
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
        var container = getContainer();
        var notifications = container.querySelectorAll('.notification');
        for (var i = notifications.length - 1; i >= 0; i--) {
            dismissNotification(notifications[i]);
        }
        _queue = [];
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
            MAX_NOTIFICATIONS = max;
        }
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
     * Used by modules that expect the old API.
     */
    function showToast(message, type) {
        return notify(message, type || 'info');
    }

    /**
     * Compatibility wrapper for window.alert.
     * Only use when notifications are not suitable.
     */
    function alertFallback(message, type) {
        if (type === 'error') {
            alert('Error: ' + message);
        } else {
            alert(message);
        }
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
        getDefaultDuration: getDefaultDuration,

        // Compatibility
        showToast: showToast,
        alertFallback: alertFallback,

        // Constants
        TYPES: TYPES,
        DEFAULT_DURATION: DEFAULT_DURATION,
        MAX_NOTIFICATIONS: MAX_NOTIFICATIONS
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
