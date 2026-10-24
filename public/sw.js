self.addEventListener("install", (event) => event.waitUntil(self.skipWaiting()))
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()))

self.addEventListener("push", (event) => {
  let message
  try { message = event.data?.json() } catch { /* Show a fallback notification for malformed push data. */ }
  const path = ["/?timer=calendar", "/?view=friends"].includes(message?.path) ? message.path : "/"
  event.waitUntil(self.registration.showNotification("Focal", {
    body: typeof message?.body === "string" ? message.body.slice(0, 200) : "You have a study update.",
    tag: typeof message?.tag === "string" ? message.tag : "focal-update",
    icon: "/icon-192.png", data: { path },
  }))
})

self.addEventListener("notificationclick", (event) => {
  event.notification.close()
  const path = event.notification.data?.path ?? "/?timer=focus"
  const url = new URL(path, self.location.origin).href
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true })
    const existing = windows.find((client) => new URL(client.url).origin === self.location.origin)
    if (existing) {
      existing.postMessage({ type: "focal:notification-click", path })
      await existing.focus()
    } else {
      await self.clients.openWindow(url)
    }
  })())
})
