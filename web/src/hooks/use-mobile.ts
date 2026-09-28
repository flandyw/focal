import * as React from "react"

const MOBILE_BREAKPOINT = 768

export function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState<boolean | undefined>(undefined)

  React.useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`)
    const onChange = () => {
      setIsMobile(window.innerWidth < MOBILE_BREAKPOINT)
    }
    mql.addEventListener("change", onChange)
    setIsMobile(window.innerWidth < MOBILE_BREAKPOINT)
    return () => mql.removeEventListener("change", onChange)
  }, [])

  return !!isMobile
}

// Reads the viewport synchronously on first render so wide-screen layouts never
// paint the narrow one first.
export function useMinWidth(breakpoint: number) {
  const [matches, setMatches] = React.useState(
    () => typeof window !== "undefined" && window.matchMedia(`(min-width: ${breakpoint}px)`).matches,
  )

  React.useEffect(() => {
    const mql = window.matchMedia(`(min-width: ${breakpoint}px)`)
    const onChange = () => setMatches(mql.matches)
    onChange()
    mql.addEventListener("change", onChange)
    return () => mql.removeEventListener("change", onChange)
  }, [breakpoint])

  return matches
}
