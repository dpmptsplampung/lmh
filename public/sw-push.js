// Handler push bersama. Registrasi /sw-push.js lama juga mendapat offline dan sync.
if (self.location.pathname === '/sw-push.js') importScripts('/sw.js');

self.addEventListener('push', (event) => {
  let data = { title: 'Notifikasi DPMPTSP Lampung', body: '' };
  try {
    if (event.data) {
      data = event.data.json() || data;
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

function notificationTarget(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return null;

  try {
    const url = new URL(raw, self.location.origin);
    if (url.protocol !== self.location.protocol || url.origin !== self.location.origin) return null;
    if (url.username || url.password) return null;
    return url.href;
  } catch {
    return null;
  }
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = notificationTarget(event.notification.data?.url) || new URL('/me', self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      const existing = clients.find((client) => notificationTarget(client.url) === target && 'focus' in client);
      if (existing) return existing.focus();
      return self.clients.openWindow?.(target);
    }),
  );
});
