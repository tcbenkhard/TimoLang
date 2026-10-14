import type { DesignProvider, DesignProviderSettings, GitHubAccount, Workflow } from './types'

const baseUrl = import.meta.env.VITE_API_URL ?? 'http://localhost:8000'
const token = import.meta.env.VITE_API_TOKEN ?? 'local-development-token'

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...init?.headers,
    },
  })
  if (!response.ok) {
    const problem = await response.json().catch(() => ({ detail: response.statusText }))
    throw new Error(problem.detail ?? 'Request failed')
  }
  if (response.status === 204) return undefined as T
  return response.json() as Promise<T>
}

export const api = {
  list: () => request<Workflow[]>('/api/workflows'),
  get: (id: string) => request<Workflow>(`/api/workflows/${id}`),
  create: (body: ({ wrike_url: string } | { test_id: string } | { request_text: string }) & { project?: string }) => request<{ id: string }>('/api/workflows', {
    method: 'POST',
    body: JSON.stringify(body),
  }),
  reviewDesign: (id: string, action: string, feedback?: string) =>
    request(`/api/workflows/${id}/design-review`, {
      method: 'POST', body: JSON.stringify({ action, feedback }),
    }),
  updatePr: (id: string, merged: boolean, feedback?: string) =>
    request(`/api/workflows/${id}/pull-request`, {
      method: 'POST', body: JSON.stringify({ merged, feedback }),
    }),
  cancel: (id: string) => request(`/api/workflows/${id}/cancel`, { method: 'POST' }),
  restart: (id: string) => request<{ id: string }>(`/api/workflows/${id}/restart`, { method: 'POST' }),
  retry: (id: string) => request(`/api/workflows/${id}/retry`, { method: 'POST' }),
  remove: (id: string) => request<void>(`/api/workflows/${id}`, { method: 'DELETE' }),
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
