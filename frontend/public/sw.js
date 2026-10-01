// Minimal service worker: just enough to receive a Web Push event and show
// a browser notification. No caching/offline logic here -- that's a
// separate concern from this feature.
self.addEventListener("push", (event) => {
  const data = event.data ? event.data.json() : { title: "Notification", body: "" };
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      data: { link: data.link },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const link = event.notification.data?.link ?? "/";
  event.waitUntil(self.clients.openWindow(link));
});
