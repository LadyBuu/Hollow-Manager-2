/**
 * utils/notification.js - Notification System
 * Toast/notification system for the application
 * Path: js/utils/notification.js
 *
 * Provides:
 *   - Toast notifications with auto-dismiss
 *   - Types: success, error, warning, info
 *   - FIFO queue with a simultaneous cap
 *   - Persistent notifications (duration 0)
 *   - Dismissal by ID
 *   - onDismiss called exactly once
 *   - Duplicate coalescing (see DEDUP)
 *
 * IMPORTANT:
 *   - Owns notification UI lifecycle.
 *   - Does not mutate application/domain data.
 *   - Does not persist.
 *   - No domain knowledge.
 *   - IdUtils.generateId is preferred; a local fallback is used
 *     if it is unavailable. Load order is not fatal.
 *
 * DEDUP:
 *   When notify() is called and an identical (message, type) toast
 *   is CURRENTLY VISIBLE, the existing toast is refreshed instead
 *   of a new one being stacked. Refresh means:
 *     - the auto-dismiss timer is reset
 *     - a short visual pulse is applied
 *     - the returned handle points at the SAME notification ID
 *     - the original duration is preserved unless the caller
 *       passes a new one explicitly
 *     - any onDismiss supplied by the refresh REPLACES the
 *       original; both are called only if the caller opted in via
 *       the handle. (See REFRESH AND ONDISMISS below.)
 *
 *   Duplicates that are QUEUED but not yet shown are NOT deduped.
 *
 * REFRESH AND ONDISMISS:
 *   Refresh replaces the notification's onDismiss with the one
 *   passed on the refresh call. If the refresh call passes no
 *   onDismiss, the original is kept. This means:
 *     - notify(msg, type, dur, fnA) -> shows a toast with fnA
 *     - notify(msg, type)           -> refreshes, keeps fnA
 *     - notify(msg, type, dur, fnB) -> refreshes, fnB replaces fnA
 *
 *   Exactly one onDismiss fires, on dismissal. It is never fired
 *   twice, and never silently dropped.
 *
 * DURATION DEFAULTS:
 *   success, info: 1.5s.
 *   warning:       2.5s.
 *   error:         4s.
 *   duration 0 (or null) is persistent.
 *
 * CAP:
 *   _maxNotifications (default 3) simultaneous toasts.
 *   _maxQueueSize (default 20) queued toasts. Beyond the queue
 *   cap, new notifications are dropped with a console warning.
 *
 * STYLES:
 *   Governed by css/shared.css. This module does not inject a
 *   stylesheet. `.notification-container`, `.notification`, and
 *   the variant classes are declared in shared.css alongside the
 *   theme tokens.
 *
 * USAGE:
 *   var n = NotificationSystem.notify('Saved!', 'success', 3000, fn);
 *   n.dismiss();
 *   n.isDismissed();
 *
 *   var p = NotificationSystem.notify('Important', 'warning', 0);
 *   p.dismiss();
 */

(function() {
    'use strict';

    if (window.__notificationLoaded) return;
    window.__notificationLoaded = true;

    // ============================================================
    // DEPENDENCIES
    // ============================================================

    // Read at call time so a late-loaded IdUtils still works.
    function getIdUtils() {
        return window.IdUtils;
    }

    // ============================================================
    // CONSTANTS
    // ============================================================

    var DEFAULT_DURATION = 1500;
    var ANIMATION_DURATION = 300;

    var _maxNotifications = 3;
    var _maxQueueSize = 20;

    var TYPES = {
        success: {
            icon: '✓',
            className: 'notification-success',
            defaultDuration: 1500,
            ariaRole: 'status',
            ariaLabel: 'Success'
        },
        error: {
            icon: '✕',
            className: 'notification-error',
            defaultDuration: 4000,
            ariaRole: 'alert',
            ariaLabel: 'Error'
        },
        warning: {
            icon: '⚠',
            className: 'notification-warning',
            defaultDuration: 2500,
            ariaRole: 'alert',
            ariaLabel: 'Warning'
        },
        info: {
            icon: 'ℹ',
            className: 'notification-info',
            defaultDuration: 1500,
            ariaRole: 'status',
            ariaLabel: 'Information'
        }
    };

    function deepFreezeTypes(obj) {
        Object.keys(obj).forEach(function(key) {
            var v = obj[key];
            if (v && typeof v === 'object') {
                Object.keys(v).forEach(function(k) {
                    if (v[k] && typeof v[k] === 'object') {
                        Object.freeze(v[k]);
                    }
                });
                Object.freeze(v);
            }
        });
        return Object.freeze(obj);
    }
    deepFreezeTypes(TYPES);

    // ============================================================
    // STATE
    // ============================================================

    var _container = null;
    var _queue = [];
    var _activeNotifications = [];
    var _nextId = 1;
    var _initialized = false;
    var _destroyed = false;
    var _pendingQueueTimers = [];

    // ============================================================
    // ID GENERATION
    // ============================================================

    function generateNotificationId() {
        var IdUtils = getIdUtils();
        if (IdUtils && typeof IdUtils.generateId === 'function') {
            return IdUtils.generateId('notif');
        }
        return 'notif_' + (_nextId++) + '_' +
               Math.random().toString(36).slice(2, 8);
    }

    // ============================================================
    // DURATION NORMALISATION
    // ============================================================

    /**
     * Resolve a duration value to a concrete number.
     * Returns 0 for persistent; a positive integer otherwise.
     */
    function resolveDuration(duration, type) {
        if (duration === undefined) {
            var cfg = TYPES[type];
            return cfg ? cfg.defaultDuration : DEFAULT_DURATION;
        }
        if (duration === null) {
            return 0;
        }
        var n = Number(duration);
        if (!isFinite(n) || n < 0) {
            var c = TYPES[type];
            return c ? c.defaultDuration : DEFAULT_DURATION;
        }
        return n === 0 ? 0 : Math.floor(n);
    }

    // ============================================================
    // CONTAINER
    // ============================================================

    function getContainer() {
        if (_container) return _container;
        if (!document.body) return null;

        _container = document.getElementById('notification-container');
        if (!_container) {
            _container = document.createElement('div');
            _container.id = 'notification-container';
            _container.className = 'notification-container';
            _container.setAttribute('role', 'region');
            _container.setAttribute('aria-label', 'Notifications');
            document.body.appendChild(_container);
        }
        return _container;
    }

    // ============================================================
    // NOTIFICATION CREATION
    // ============================================================

    function createNotificationDOM(item) {
        var type = item.type;
        var cfg = TYPES[type] || TYPES.info;
        var duration = item.duration;  // already resolved
        var isPersistent = duration === 0;

        var notification = document.createElement('div');
        notification.className = 'notification ' + cfg.className;
        notification.setAttribute('role', cfg.ariaRole);
        notification.setAttribute('aria-label', cfg.ariaLabel);
        notification.setAttribute('aria-live',
            cfg.ariaRole === 'alert' ? 'assertive' : 'polite');
        notification.dataset.notificationId = item.id;

        var icon = document.createElement('span');
        icon.className = 'notification-icon';
        icon.setAttribute('aria-hidden', 'true');
        icon.textContent = cfg.icon;
        notification.appendChild(icon);

        var content = document.createElement('span');
        content.className = 'notification-content';
        content.textContent = item.message;
        notification.appendChild(content);

        var closeBtn = document.createElement('button');
        closeBtn.className = 'notification-close';
        closeBtn.setAttribute('aria-label', 'Dismiss notification');
        closeBtn.setAttribute('type', 'button');
        closeBtn.textContent = '×';
        closeBtn.addEventListener('click', function(e) {
            e.stopPropagation();
            dismissNotification(item.id);
        });
        notification.appendChild(closeBtn);

        // Node-level state. onDismiss lives here, not in _queue.
        notification._id = item.id;
        notification._message = item.message;
        notification._type = type;
        notification._duration = duration;
        notification._onDismiss = item.onDismiss || null;
        notification._dismissed = false;
        notification._timer = null;

        if (!isPersistent) {
            notification._timer = setTimeout(function() {
                dismissNotification(item.id);
            }, duration);
        }

        return notification;
    }

    // ============================================================
    // DISMISSAL
    // ============================================================

    /**
     * Dismiss a notification by id, whether it is currently shown
     * or still in the queue. Safe to call multiple times.
     */
    function dismissNotification(notificationId) {
        if (!notificationId) return;

        // ---- Active notification ----
        var activeIndex = -1;
        for (var i = 0; i < _activeNotifications.length; i++) {
            if (_activeNotifications[i] && _activeNotifications[i]._id === notificationId) {
                activeIndex = i;
                break;
            }
        }

        if (activeIndex !== -1) {
            _dismissActive(activeIndex);
            return;
        }

        // ---- Queued notification ----
        var queueIndex = -1;
        for (var j = 0; j < _queue.length; j++) {
            if (_queue[j] && _queue[j].id === notificationId) {
                queueIndex = j;
                break;
            }
        }

        if (queueIndex !== -1) {
            var item = _queue[queueIndex];
            _queue.splice(queueIndex, 1);
            if (typeof item.onDismiss === 'function') {
                try { item.onDismiss(); } catch (e) {}
            }
        }
    }

    function _dismissActive(index) {
        var notification = _activeNotifications[index];
        if (!notification || notification._dismissed) return;

        notification._dismissed = true;

        if (notification._timer) {
            clearTimeout(notification._timer);
            notification._timer = null;
        }

        var onDismiss = notification._onDismiss;
        notification._onDismiss = null;

        // Do NOT remove from _activeNotifications yet. The hide
        // animation runs first, and the cap should reflect the
        // toast until it is fully gone.
        notification.classList.remove('visible');
        notification.classList.add('hiding');

        setTimeout(function() {
            // Remove from active list after animation.
            var idx = _activeNotifications.indexOf(notification);
            if (idx !== -1) {
                _activeNotifications.splice(idx, 1);
            }

            if (notification.parentNode) {
                notification.parentNode.removeChild(notification);
            }

            // Fire onDismiss exactly once.
            if (typeof onDismiss === 'function') {
                try { onDismiss(); } catch (e) {}
            }

            processQueue();
        }, ANIMATION_DURATION);
    }

    // ============================================================
    // DEDUP
    // ============================================================

    /**
     * Find a currently-visible notification matching (message, type).
     * Queued-but-not-shown duplicates are ignored.
     */
    function findActiveDuplicate(message, type) {
        for (var i = 0; i < _activeNotifications.length; i++) {
            var n = _activeNotifications[i];
            if (!n || n._dismissed) continue;
            if (n._message !== message) continue;
            if (n._type !== type) continue;
            return n;
        }
        return null;
    }

    /**
     * Refresh a visible duplicate: reset the timer with the
     * original duration (unless the caller passed a new one),
     * pulse the toast, update the onDismiss if a new one was
     * passed, and return a handle pointing at the same id.
     */
    function refreshDuplicate(existing, type, rawDuration, onDismiss) {
        var newDuration;
        if (rawDuration === undefined) {
            newDuration = existing._duration;
        } else {
            newDuration = resolveDuration(rawDuration, type);
        }

        if (existing._timer) {
            clearTimeout(existing._timer);
            existing._timer = null;
        }

        existing._duration = newDuration;

        if (newDuration > 0) {
            existing._timer = setTimeout(function() {
                dismissNotification(existing._id);
            }, newDuration);
        }

        if (typeof onDismiss === 'function') {
            existing._onDismiss = onDismiss;
        }

        // Force a reflow so the pulse animation restarts even if
        // it was recently applied.
        existing.classList.remove('pulse');
        // eslint-disable-next-line no-unused-expressions
        void existing.offsetWidth;
        existing.classList.add('pulse');

        setTimeout(function() {
            if (existing && existing.classList) {
                existing.classList.remove('pulse');
            }
        }, 260);

        return makeHandle(existing._id);
    }

    // ============================================================
    // QUEUE
    // ============================================================

    function processQueue() {
        if (_destroyed) return;
        if (_activeNotifications.length >= _maxNotifications) return;
        if (_queue.length === 0) return;

        var container = getContainer();
        if (!container) {
            // Body not available yet; retry on the next tick.
            scheduleProcessQueue(50);
            return;
        }

        var item = _queue.shift();
        var notification = createNotificationDOM(item);
        container.appendChild(notification);
        _activeNotifications.push(notification);

        // rAF doesn't fire in background tabs. Use it when the tab
        // is visible; otherwise fall back to a microtask so the
        // `visible` class still gets applied and the timer still
        // counts down coherently.
        if (typeof document.hidden === 'boolean' && document.hidden) {
            setTimeout(function() {
                notification.classList.add('visible');
            }, 0);
        } else if (typeof requestAnimationFrame === 'function') {
            requestAnimationFrame(function() {
                notification.classList.add('visible');
            });
        } else {
            setTimeout(function() {
                notification.classList.add('visible');
            }, 0);
        }

        if (_activeNotifications.length < _maxNotifications && _queue.length > 0) {
            scheduleProcessQueue(50);
        }
    }

    function scheduleProcessQueue(delay) {
        var timer = setTimeout(function() {
            var idx = _pendingQueueTimers.indexOf(timer);
            if (idx !== -1) _pendingQueueTimers.splice(idx, 1);
            processQueue();
        }, delay);
        _pendingQueueTimers.push(timer);
    }

    function enqueue(item) {
        if (_queue.length >= _maxQueueSize) {
            if (typeof console !== 'undefined' && console.warn) {
                console.warn(
                    '[NotificationSystem] queue full (' +
                    _maxQueueSize + '), dropping notification: ' +
                    item.message
                );
            }
            // Fire the callback so the caller doesn't hang.
            if (typeof item.onDismiss === 'function') {
                try { item.onDismiss(); } catch (e) {}
            }
            return;
        }
        _queue.push(item);
        if (_activeNotifications.length < _maxNotifications) {
            processQueue();
        }
    }

    // ============================================================
    // INIT / DESTROY
    // ============================================================

    function init() {
        if (_initialized) return;
        if (!document.body) {
            // Defer; DOMContentLoaded will trigger init again if
            // the module auto-init path is what called us.
            return;
        }
        _destroyed = false;
        getContainer();
        _initialized = true;
    }

    function destroy() {
        clearNotifications(false);

        // Cancel pending queue timers.
        for (var i = 0; i < _pendingQueueTimers.length; i++) {
            clearTimeout(_pendingQueueTimers[i]);
        }
        _pendingQueueTimers = [];

        if (_container && _container.parentNode) {
            _container.parentNode.removeChild(_container);
        }
        _container = null;
        _initialized = false;
        _destroyed = true;
    }

    // ============================================================
    // PUBLIC API
    // ============================================================

    function makeHandle(id) {
        return {
            id: id,
            dismiss: function() { dismissNotification(id); },
            isDismissed: function() { return isIdDismissed(id); }
        };
    }

    function isIdDismissed(id) {
        for (var i = 0; i < _queue.length; i++) {
            if (_queue[i] && _queue[i].id === id) return false;
        }
        for (var j = 0; j < _activeNotifications.length; j++) {
            var n = _activeNotifications[j];
            if (n && n._id === id && !n._dismissed) return false;
        }
        return true;
    }

    /**
     * Show a notification.
     *
     * @param {string} message
     * @param {string} [type='info']
     * @param {number} [duration] - ms; 0 or null for persistent
     * @param {function} [onDismiss]
     * @returns {object|null} Handle with dismiss() and isDismissed()
     */
    function notify(message, type, duration, onDismiss) {
        if (message === undefined || message === null || message === '') {
            if (typeof console !== 'undefined' && console.warn) {
                console.warn('[NotificationSystem] No message provided.');
            }
            return null;
        }

        if (!_initialized) init();
        if (!getContainer()) {
            // Still no body; defer to DOMContentLoaded.
            if (typeof console !== 'undefined' && console.warn) {
                console.warn(
                    '[NotificationSystem] document.body not available; ' +
                    'queuing notify() call.'
                );
            }
            var deferredMessage = String(message);
            var deferredType = type || 'info';
            var deferredDuration = duration;
            var deferredCb = onDismiss;

            if (!window.__notificationDeferredReady) {
                window.__notificationDeferredReady = true;
                document.addEventListener('DOMContentLoaded', function() {
                    notify(deferredMessage, deferredType,
                           deferredDuration, deferredCb);
                });
            }
            return null;
        }

        var messageStr = String(message);
        var resolvedType = TYPES[type] ? type : 'info';

        // ---- Dedup against visible toast ----
        var existing = findActiveDuplicate(messageStr, resolvedType);
        if (existing) {
            return refreshDuplicate(
                existing, resolvedType, duration, onDismiss
            );
        }

        // ---- Enqueue new ----
        var id = generateNotificationId();
        var resolvedDuration = resolveDuration(duration, resolvedType);

        enqueue({
            id: id,
            message: messageStr,
            type: resolvedType,
            duration: resolvedDuration,
            onDismiss: typeof onDismiss === 'function' ? onDismiss : null
        });

        return makeHandle(id);
    }

    function notifySuccess(message, duration, onDismiss) {
        return notify(message, 'success', duration, onDismiss);
    }
    function notifyError(message, duration, onDismiss) {
        return notify(message, 'error', duration, onDismiss);
    }
    function notifyWarning(message, duration, onDismiss) {
        return notify(message, 'warning', duration, onDismiss);
    }
    function notifyInfo(message, duration, onDismiss) {
        return notify(message, 'info', duration, onDismiss);
    }

    /**
     * Clear all notifications.
     *
     * @param {boolean} [callCallbacks=true] - Fire onDismiss for
     *   every cleared notification (active and queued).
     */
    function clearNotifications(callCallbacks) {
        callCallbacks = callCallbacks !== false;

        var queued = _queue.slice();
        _queue = [];

        var active = _activeNotifications.slice();
        _activeNotifications = [];

        active.forEach(function(n) {
            if (n._timer) {
                clearTimeout(n._timer);
                n._timer = null;
            }
            if (n.parentNode) {
                n.parentNode.removeChild(n);
            }
            var cb = n._onDismiss;
            n._onDismiss = null;
            n._dismissed = true;
            if (callCallbacks && typeof cb === 'function') {
                try { cb(); } catch (e) {}
            }
        });

        if (callCallbacks) {
            queued.forEach(function(item) {
                if (typeof item.onDismiss === 'function') {
                    try { item.onDismiss(); } catch (e) {}
                }
            });
        }
    }

    function getNotificationCount() {
        return _activeNotifications.length + _queue.length;
    }

    function getNotificationContainer() {
        return getContainer();
    }

    function setMaxNotifications(max) {
        if (typeof max === 'number' && max > 0) {
            _maxNotifications = Math.floor(max);
            // Drain if the cap was raised.
            while (_activeNotifications.length < _maxNotifications &&
                   _queue.length > 0) {
                processQueue();
                // processQueue schedules follow-ups; break if the
                // queue didn't move (avoid infinite loop).
                if (_activeNotifications.length === 0) break;
                if (_activeNotifications.length >= _maxNotifications) break;
                // If nothing happened (e.g. no container), stop.
                break;
            }
        }
    }
    function getMaxNotifications() { return _maxNotifications; }

    function setMaxQueueSize(size) {
        if (typeof size === 'number' && size >= 0) {
            _maxQueueSize = Math.floor(size);
        }
    }
    function getMaxQueueSize() { return _maxQueueSize; }

    function getDefaultDuration(type) {
        var cfg = TYPES[type];
        return cfg ? cfg.defaultDuration : DEFAULT_DURATION;
    }

    function isInitialized() { return _initialized; }

    function showToast(message, type) {
        return notify(message, type || 'info');
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.NotificationSystem = Object.freeze({
        notify: notify,
        notifySuccess: notifySuccess,
        notifyError: notifyError,
        notifyWarning: notifyWarning,
        notifyInfo: notifyInfo,

        clearNotifications: clearNotifications,
        getNotificationCount: getNotificationCount,
        getNotificationContainer: getNotificationContainer,
        setMaxNotifications: setMaxNotifications,
        getMaxNotifications: getMaxNotifications,
        setMaxQueueSize: setMaxQueueSize,
        getMaxQueueSize: getMaxQueueSize,
        getDefaultDuration: getDefaultDuration,

        init: init,
        destroy: destroy,
        isInitialized: isInitialized,

        showToast: showToast,

        TYPES: TYPES,
        DEFAULT_DURATION: DEFAULT_DURATION,
        ANIMATION_DURATION: ANIMATION_DURATION,
        get MAX_NOTIFICATIONS() { return _maxNotifications; }
    });

    window.notify = notify;
    window.showToast = showToast;

    if (document.readyState === 'complete' ||
        document.readyState === 'interactive') {
        init();
    } else {
        document.addEventListener('DOMContentLoaded', init);
    }

})();
