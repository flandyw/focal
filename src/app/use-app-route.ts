import { startTransition, useEffect, useLayoutEffect, useRef, useState } from "react"
import { loadAppView, saveAppView, type AppView } from "../lib/app-view"
import { handleBack } from "../lib/mobile"
import { ALL_NAVIGATION } from "../lib/navigation"
import { parseRoute, type AppRoute } from "../lib/routes"

const initialRoute = typeof location === "undefined" ? null : parseRoute(location.pathname)

/** Router state: the current page, its record id and query. The URL is written by useRouteUrl once the subject is known. */
export function useAppRoute(embedded: boolean, onBack: (route: AppRoute | null, search: string) => void) {
  const [view, commitView] = useState<AppView>(() => embedded ? "exams" : initialRoute?.view ?? loadAppView(
    typeof localStorage === "undefined" ? null : localStorage,
    typeof location === "undefined" ? "" : location.search,
  ))
  // The tab bar answers the tap at once; the page swaps in a transition, so a slow page or chunk never freezes the tap.
  const [navView, setNavView] = useState(view)
  const [recordId, setRecordId] = useState(initialRoute?.id)
  const [routeSearch, setRouteSearch] = useState(() => typeof location === "undefined" ? "" : location.search)
  const fromBack = useRef(false)
  const scrollByView = useRef(new Map<AppView, number>())

  function setView(next: AppView, id?: string, search = "") {
    setNavView(next)
    startTransition(() => {
      setRecordId(id)
      setRouteSearch(search)
      commitView(next)
    })
  }
  function closeRecord() {
    setRecordId(undefined)
    setRouteSearch("")
  }

  useEffect(() => saveAppView(typeof localStorage === "undefined" ? null : localStorage, view), [view])
  // Each page remembers its own scroll; without this a new tab opens part-way down.
  useLayoutEffect(() => { window.scrollTo(0, scrollByView.current.get(view) ?? 0) }, [view])
  useEffect(() => {
    const remember = () => { scrollByView.current.set(view, window.scrollY) }
    window.addEventListener("scroll", remember, { passive: true })
    return () => window.removeEventListener("scroll", remember)
  }, [view])
  useEffect(() => { document.title = `${ALL_NAVIGATION.find((item) => item.id === view)?.label ?? "Study"} · Focal` }, [view])
  // Without history entries, Android's back button quits the installed app from any page.
  useEffect(() => {
    if (embedded) return
    return handleBack<AppView>((next) => {
      const route = parseRoute(location.pathname)
      fromBack.current = true
      setNavView(route?.view ?? next)
      startTransition(() => {
        onBack(route, location.search)
        setRecordId(route?.id)
        setRouteSearch(location.search)
        commitView(route?.view ?? next)
      })
    })
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- onBack only touches stable state setters
  }, [embedded])

  // True once for the render Back caused, so the URL effect leaves that history entry alone.
  function consumeBack() {
    const was = fromBack.current
    fromBack.current = false
    return was
  }

  return { view, navView, recordId, routeSearch, setRouteSearch, setView, closeRecord, consumeBack, initialRoute }
}

/** Mirrors the current page into the address bar, skipping the entry Back just restored. */
export function useRouteUrl(embedded: boolean, view: AppView, path: string, consumeBack: () => boolean) {
  useLayoutEffect(() => {
    if (embedded || consumeBack()) return
    if (!history.state?.view) history.replaceState({ ...history.state, view }, "", path)
    else if (location.pathname + location.search + location.hash !== path) history.pushState({ view }, "", path)
      // oxlint-disable-next-line react-hooks/exhaustive-deps -- consumeBack only reads a ref
  }, [embedded, view, path])
}
