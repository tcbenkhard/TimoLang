import axe from 'axe-core'
import { vi } from 'vitest'
import type { Phase, Workflow } from '../types'

export const workflowId = '0f8fad5b-d9cb-469f-a165-70867728950e'

export function makeWorkflow(overrides: Partial<Workflow> = {}): Workflow {
  return {
    id: workflowId,
    thread_id: 'thread-0123456789abcdef',
    wrike_url: 'https://www.wrike.com/open.htm?id=1',
    title: 'Improve the dashboard',
    phase: 'developing' as Phase,
    current_design_version: 1,
    created_at: '2026-10-01T10:00:00Z',
    updated_at: '2026-10-01T10:05:00Z',
    designs: [{ version: 1, markdown: '# Design\n\nBody', created_at: '2026-10-01T10:01:00Z' }],
    events: [],
    state: { source_kind: 'wrike' },
    ...overrides,
  }
}

export function jsonResponse(body: unknown, status = 200) {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

type Handler = (url: string, init: RequestInit) => Response | Promise<Response>

/** Stubs fetch; `routes` keys are "METHOD /path" and unmatched requests return 404. */
export function mockFetch(routes: Record<string, Handler | unknown>) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(String(input))
    const key = `${init.method ?? 'GET'} ${url.pathname}`
    const route = routes[key]
    if (route === undefined) return jsonResponse({ detail: 'Not found' }, 404)
    return typeof route === 'function' ? (route as Handler)(String(input), init) : jsonResponse(route)
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

/** Fails on serious or critical axe violations. */
export async function expectNoSeriousAxeViolations(container: Element) {
  const { violations } = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } })
  const serious = violations.filter(violation => violation.impact === 'serious' || violation.impact === 'critical')
  if (serious.length > 0) {
    throw new Error(serious.map(violation => `${violation.id}: ${violation.nodes.map(node => node.html).join(', ')}`).join('\n'))
  }
}
