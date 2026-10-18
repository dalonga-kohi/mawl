import { useSyncExternalStore } from 'react'

/** DESIGN.md §5 breakpoints. */
export const WIDE = '(min-width: 1100px)'
export const MEDIUM = '(min-width: 760px)'

export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const list = window.matchMedia(query)
      list.addEventListener('change', onChange)
      return () => list.removeEventListener('change', onChange)
    },
    () => window.matchMedia(query).matches,
    () => false,
  )
}
