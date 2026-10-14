export type Route =
  | { name: 'dashboard' }
  | { name: 'workflow', id: string }
  | { name: 'settings' }
  | { name: 'not-found' }

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const paths = {
  dashboard: '/',
  settings: '/settings',
  workflow: (id: string) => `/workflows/${encodeURIComponent(id)}`,
}

export function parseRoute(pathname: string): Route {
  const path = pathname.replace(/\/+$/, '') || '/'
  if (path === '/') return { name: 'dashboard' }
  if (path === paths.settings) return { name: 'settings' }
  const workflow = /^\/workflows\/([^/]+)$/.exec(path)
  if (workflow && uuidPattern.test(workflow[1])) return { name: 'workflow', id: workflow[1].toLowerCase() }
  return { name: 'not-found' }
}

export function navigate(path: string, options: { replace?: boolean } = {}) {
  if (options.replace) window.history.replaceState(null, '', path)
  else window.history.pushState(null, '', path)
  window.dispatchEvent(new PopStateEvent('popstate'))
  window.scrollTo?.({ top: 0 })
}
