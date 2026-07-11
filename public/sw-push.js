// sw-push.js — Service worker for web push notifications (I5)
// Registered by /me/notifications page. Minimal: show notification on push.
// Keep framework-agnostic (no build step) so it can be served from /public.

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  let data = { title: 'Notifikasi DPMPTSP Lampung', body: '' };
  try {
    if (event.data) {
      data = event.data.json();
    }
  } catch {
    data.body = event.data ? event.data.text() : '';
  }
  event.waitUntil(
    self.registration.showNotification(data.title || 'Notifikasi DPMPTSP Lampung', {
      body: data.body || '',
      icon: '/logo.png',
      badge: '/logo.png',
      data: data.payload || {},
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || '/me';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes(target) && 'focus' in client) {
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(target);
      }
      return null;
    }),
  );
});
