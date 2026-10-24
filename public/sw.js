const CACHE = "focal-v1"

self.addEventListener("install", (event) => event.waitUntil(self.skipWaiting()))
self.addEventListener("activate", (event) => event.waitUntil((async () => {
  for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key)
  await self.clients.claim()
})()))

async function put(request, response) {
  if (!response.ok || response.type !== "basic") return
  const cache = await caches.open(CACHE)
  await cache.put(request, response)
  // shortcut: oldest-first trim by insertion order, not LRU; fine while a deploy is ~100 chunks.
  const keys = await cache.keys()
  for (const key of keys.slice(0, Math.max(0, keys.length - 300))) await cache.delete(key)
}

// Clones before the page reads the body; waitUntil is registered synchronously so the write isn't cut off.
function fetchAndCache(event, key) {
  const network = fetch(event.request)
  event.waitUntil(network.then((response) => put(key, response.clone())).catch(() => undefined))
  return network
}

// Swaps in a new shell only after its entry chunks are cached, so a deploy never opens on a blank screen while they download.
async function refreshShell() {
  const response = await fetch("/", { cache: "no-store" })
  if (!response.ok) return response
  const copy = response.clone()
  const html = await response.clone().text()
  const assets = [...new Set([...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((match) => match[1]))]
  await (await caches.open(CACHE)).addAll(assets)
  await put("/", copy)
  return response
}

self.addEventListener("fetch", (event) => {
  const { request } = event
  const url = new URL(request.url)
  if (request.method !== "GET" || url.origin !== self.location.origin) return
  // API calls stay live; Vite dev modules must never be served stale.
  if (["/api/", "/src/", "/node_modules/", "/@"].some((prefix) => url.pathname.startsWith(prefix))) return
  // Cache first so launch never waits on the network; the page's update check refreshes the shell for the next launch.
  if (request.mode === "navigate") {
    event.respondWith(caches.match("/").then((cached) => cached ?? refreshShell()).catch(() => Response.error()))
    return
  }
  if (url.pathname === "/") {
    event.respondWith(refreshShell())
    return
  }
  const immutable = url.pathname.startsWith("/assets/")
  if (!immutable && !/\.(json|woff2|png|svg|webmanifest)$/.test(url.pathname)) return
  event.respondWith(caches.match(request).then((cached) => {
    // Hashed chunks never change; datasets, fonts and icons render from cache and refresh in the background.
    if (cached && immutable) return cached
    const network = fetchAndCache(event, request)
    return cached ?? network
  }))
})

self.addEventListener("push", (event) => {
  let message
  try { message = event.data?.json() } catch { /* Show a fallback notification for malformed push data. */ }
  const path = ["/?timer=calendar", "/?view=friends", "/?timer=sac", "/?timer=focus", "/?timer=exam"].includes(message?.path) ? message.path : "/"
  event.waitUntil(self.registration.showNotification("Focal", {
    body: typeof message?.body === "string" ? message.body.slice(0, 200) : "You have a study update.",
    tag: typeof message?.tag === "string" ? message.tag : "focal-update",
    icon: "/icon-192.png", badge: "/icon-192.png", data: { path },
  }))
})

self.addEventListener("notificationclick", (event) => {
  event.notification.close()
  const requested = event.notification.data?.path
  const path = ["/", "/?timer=calendar", "/?view=friends", "/?timer=sac", "/?timer=focus", "/?timer=exam"].includes(requested) ? requested : "/?timer=focus"
  const url = new URL(path, self.location.origin).href
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true })
    const ours = windows.filter((client) => new URL(client.url).origin === self.location.origin)
    const existing = ours.find((client) => client.focused) ?? ours[0]
    if (existing) {
      existing.postMessage({ type: "focal:notification-click", path })
      await existing.focus()
    } else {
      await self.clients.openWindow(url)
    }
  })())
})
