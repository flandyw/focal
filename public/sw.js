const CACHE = "focal-v1"

self.addEventListener("install", (event) => event.waitUntil((async () => {
  await (await caches.open(CACHE)).addAll(["/icon-192.png", "/badge-96.png"]).catch(() => undefined)
  await self.skipWaiting()
})()))
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

// Only reachable before the shell's first successful download.
const OFFLINE_PAGE = `<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light dark"><title>Focal</title><body style="display:grid;place-content:center;min-height:90dvh;margin:0;padding:1.5rem;font:1rem system-ui;text-align:center"><p>Focal needs a connection the first time it opens.</p><button onclick="location.reload()" style="font:inherit;padding:.75rem 1.25rem">Try again</button>`

// A shell that can't boot the app must never open: its page can't run the update check that would replace it.
const bootable = (html) => html.includes('id="root"')

// Swaps in a new shell only after its entry chunks are cached, so a deploy never opens on a blank screen while they download.
async function refreshShell() {
  const response = await fetch("/", { cache: "no-store" })
  if (!response.ok) return response
  const copy = response.clone()
  const html = await response.clone().text()
  if (!bootable(html)) return response
  const assets = [...new Set([...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((match) => match[1]))]
  await (await caches.open(CACHE)).addAll(assets)
  await put("/", copy)
  return response
}

// Cache first so launch never waits on the network; the worker refreshes the shell itself so a broken launch still heals.
async function openShell(event) {
  const refreshed = refreshShell()
  event.waitUntil(refreshed.catch(() => undefined))
  const cached = await caches.match("/")
  return cached && bootable(await cached.clone().text()) ? cached : refreshed
}

self.addEventListener("fetch", (event) => {
  const { request } = event
  const url = new URL(request.url)
  if (request.method !== "GET" || url.origin !== self.location.origin) return
  // API calls stay live; Vite dev modules must never be served stale.
  if (["/api/", "/src/", "/node_modules/", "/@"].some((prefix) => url.pathname.startsWith(prefix))) return
  if (request.mode === "navigate") {
    event.respondWith(openShell(event).catch(() => new Response(OFFLINE_PAGE, { status: 503, headers: { "Content-Type": "text/html; charset=utf-8" } })))
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

const PATHS = ["/", "/?timer=calendar", "/?view=friends", "/?timer=sac", "/?timer=focus", "/?timer=exam"]

self.addEventListener("push", (event) => {
  let message
  try { message = event.data?.json() } catch { /* Show a fallback notification for malformed push data. */ }
  event.waitUntil(self.registration.showNotification(typeof message?.title === "string" ? message.title.slice(0, 80) : "Focal", {
    body: typeof message?.body === "string" ? message.body.slice(0, 200) : "You have a study update.",
    tag: typeof message?.tag === "string" ? message.tag : "focal-update",
    icon: "/icon-192.png", badge: "/badge-96.png", vibrate: [200, 100, 200], timestamp: Date.now(),
    data: { path: PATHS.includes(message?.path) ? message.path : "/" },
  }))
})

// The browser rotated this device's subscription; an open app re-registers it, a closed one does on its next launch.
self.addEventListener("pushsubscriptionchange", (event) => event.waitUntil((async () => {
  for (const client of await self.clients.matchAll({ type: "window", includeUncontrolled: true })) client.postMessage({ type: "focal:push-changed" })
})()))

self.addEventListener("notificationclick", (event) => {
  event.notification.close()
  const requested = event.notification.data?.path
  const path = PATHS.includes(requested) ? requested : "/"
  const url = new URL(path, self.location.origin).href
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true })
    const ours = windows.filter((client) => new URL(client.url).origin === self.location.origin)
    const existing = ours.find((client) => client.focused) ?? ours[0]
    try {
      if (!existing) throw new Error("No open window")
      existing.postMessage({ type: "focal:notification-click", path })
      await existing.focus()
    } catch {
      // No window, or iOS refused to focus a suspended one: a fresh launch still lands on the right page.
      await self.clients.openWindow(url)
    }
  })())
})
