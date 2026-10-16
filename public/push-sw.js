// Web push handlers. Loaded into the workbox service worker with importScripts.
self.addEventListener('push', (event) => {
  let msg = {};
  try { msg = event.data.json(); } catch { /* not JSON: show the default title */ }
  event.waitUntil(self.registration.showNotification(msg.title || 'Tee Times', {
    body: msg.body,
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    data: { url: msg.url || '/' },
    ...(msg.tag && { tag: msg.tag, renotify: true }),
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || '/', self.location.origin).href;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const open = windows.find((w) => 'focus' in w);
    if (open) {
      await open.navigate(url);
      return open.focus();
    }
    return self.clients.openWindow(url);
  })());
});
