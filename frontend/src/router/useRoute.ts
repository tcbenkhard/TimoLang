import { useMemo, useSyncExternalStore } from 'react'
import { parseRoute } from './routes'

function subscribe(onChange: () => void) {
  window.addEventListener('popstate', onChange)
  return () => window.removeEventListener('popstate', onChange)
}

const currentPath = () => window.location.pathname

/** Current route derived from the browser location; updates on navigate() and back/forward. */
export function useRoute() {
  const pathname = useSyncExternalStore(subscribe, currentPath)
  return useMemo(() => parseRoute(pathname), [pathname])
}
