import { createSseParser } from './lib/sse'
import type { DesignProvider, DesignProviderSettings, GitHubAccount, Workflow } from './types'

const baseUrl = import.meta.env.VITE_API_URL ?? 'http://localhost:8000'
const token = import.meta.env.VITE_API_TOKEN ?? 'local-development-token'

export const networkErrorMessage = 'Unable to reach the Relay API. Check that the backend is running.'

/** An API failure with readable messages; status 0 means the request never reached the server. */
export class ApiError extends Error {
  readonly status: number
  readonly messages: string[]

  constructor(status: number, messages: string[]) {
    super(messages.join(' '))
    this.name = 'ApiError'
    this.status = status
    this.messages = messages
  }
}

interface ValidationIssue {
  loc?: (string | number)[]
  msg?: string
}

/** Normalises FastAPI `detail` payloads (a string or a list of 422 validation issues). */
export function problemMessages(detail: unknown, fallback: string): string[] {
  if (typeof detail === 'string' && detail.trim()) return [detail]
  if (!Array.isArray(detail)) return [fallback]
  const messages = detail.map((issue: ValidationIssue) => {
    const field = (issue.loc ?? []).filter(part => part !== 'body').join('.')
    const message = issue.msg ?? 'Invalid value'
    return field ? `${field}: ${message}` : message
  })
  return messages.length > 0 ? messages : [fallback]
}

export function errorMessage(problem: unknown, fallback: string) {
  if (problem instanceof Error && problem.message) return problem.message
  return fallback
}

async function send(path: string, init?: RequestInit): Promise<Response> {
  let response: Response
  try {
    response = await fetch(`${baseUrl}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...init?.headers,
      },
    })
  } catch (problem) {
    if (init?.signal?.aborted) throw problem
    throw new ApiError(0, [networkErrorMessage])
  }
  if (!response.ok) {
    const fallback = response.statusText || `Request failed (${response.status})`
    const problem = await response.json().catch(() => ({ detail: fallback }))
    throw new ApiError(response.status, problemMessages(problem?.detail, fallback))
  }
  return response
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await send(path, init)
  if (response.status === 204) return undefined as T
  return response.json() as Promise<T>
}

const workflowPath = (id: string) => `/api/workflows/${encodeURIComponent(id)}`

/**
 * Reads the authenticated SSE stream for a workflow. Native EventSource cannot send the
 * Authorization header, and the token must never be placed in the URL, so fetch is used.
 * Resolves when the server closes the stream; rejects on network or HTTP errors.
 */
async function streamWorkflow(id: string, onWorkflow: (workflow: Workflow) => void, signal: AbortSignal) {
  const response = await send(`${workflowPath(id)}/events`, { signal, headers: { Accept: 'text/event-stream' } })
  if (!response.body) throw new ApiError(response.status, ['Live updates are not supported by this browser.'])
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  const parse = createSseParser(({ event, data }) => {
    if (event === 'workflow') onWorkflow(JSON.parse(data) as Workflow)
  })
  for (;;) {
    const { done, value } = await reader.read()
    if (done) return
    parse(decoder.decode(value, { stream: true }))
  }
}

export type WorkflowSource = { wrike_url: string } | { test_id: string } | { request_text: string }

export const api = {
  list: () => request<Workflow[]>('/api/workflows'),
  get: (id: string) => request<Workflow>(workflowPath(id)),
  streamWorkflow,
  create: (body: WorkflowSource & { project?: string }) => request<{ id: string }>('/api/workflows', {
    method: 'POST',
    body: JSON.stringify(body),
  }),
  reviewDesign: (id: string, action: 'approve' | 'request_changes' | 'reject', feedback?: string) =>
    request(`${workflowPath(id)}/design-review`, {
      method: 'POST', body: JSON.stringify({ action, feedback }),
    }),
  updatePr: (id: string, merged: boolean, feedback?: string) =>
    request(`${workflowPath(id)}/pull-request`, {
      method: 'POST', body: JSON.stringify({ merged, feedback }),
    }),
  cancel: (id: string) => request(`${workflowPath(id)}/cancel`, { method: 'POST' }),
  restart: (id: string) => request<{ id: string }>(`${workflowPath(id)}/restart`, { method: 'POST' }),
  retry: (id: string) => request(`${workflowPath(id)}/retry`, { method: 'POST' }),
  remove: (id: string) => request<void>(workflowPath(id), { method: 'DELETE' }),
  githubAccounts: () => request<GitHubAccount[]>('/api/settings/github-accounts'),
  browseSshKey: () => request<{ path: string | null }>('/api/settings/browse-ssh-key', {
    method: 'POST',
  }),
  saveGithubAccount: (account: string, sshKeyPath: string) =>
    request<GitHubAccount>(`/api/settings/github-accounts/${encodeURIComponent(account)}`, {
      method: 'PUT', body: JSON.stringify({ account, ssh_key_path: sshKeyPath }),
    }),
  deleteGithubAccount: (account: string) =>
    request(`/api/settings/github-accounts/${encodeURIComponent(account)}`, { method: 'DELETE' }),
  designProvider: () => request<DesignProviderSettings>('/api/settings/design-provider'),
  saveDesignProvider: (provider: DesignProvider) =>
    request<DesignProviderSettings>('/api/settings/design-provider', {
      method: 'PUT', body: JSON.stringify({ provider }),
    }),
}
