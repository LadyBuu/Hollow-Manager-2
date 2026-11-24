/* Hollow Manager 2 service worker
 * Relative URLs keep this working when hosted at a GitHub Pages project path.
 */
'use strict';

var CACHE_NAME = 'hollow-manager-shell-v1';
var SHELL_FILES = [
    './',
    './index.html',
    './manifest.webmanifest',
    './icons/app-icon.svg'
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
                if (key !== CACHE_NAME && key.indexOf('hollow-manager-') === 0) {
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
                if (response && response.ok) {
                    var copy = response.clone();
                    caches.open(CACHE_NAME).then(function(cache) {
                        cache.put('./index.html', copy);
                    });
                }
                return response;
            }).catch(function() {
                return caches.match(request).then(function(cached) {
                    return cached || caches.match('./index.html');
                });
            })
        );
        return;
    }

    // Network-first for app resources: updates are picked up when online,
    // while successful responses are retained for later offline use.
    event.respondWith(
        fetch(request).then(function(response) {
            if (response && response.ok && response.type === 'basic') {
                var copy = response.clone();
                caches.open(CACHE_NAME).then(function(cache) {
                    cache.put(request, copy);
                });
            }
            return response;
        }).catch(function() {
            return caches.match(request);
        })
    );
});
