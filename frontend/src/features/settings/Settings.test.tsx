import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { expectNoSeriousAxeViolations, jsonResponse, mockFetch } from '../../test/fixtures'
import { Settings } from './Settings'

const providerSettings = { provider: 'codex', availability: { codex: true, claude: true } }
const accounts = [{ account: 'octocat', ssh_key_path: '/home/me/.ssh/id_octocat', key_available: false }]

function mockSettings(overrides: Record<string, unknown> = {}) {
  return mockFetch({
    'GET /api/settings/github-accounts': accounts,
    'GET /api/settings/design-provider': providerSettings,
    ...overrides,
  })
}

describe('Settings', () => {
  it('exposes the provider selection with aria-pressed and reports save failures', async () => {
    mockSettings({ 'PUT /api/settings/design-provider': () => jsonResponse({ detail: 'Claude Code is not installed' }, 409) })
    render(<Settings />)
    const claude = await screen.findByRole('button', { name: 'Claude Code' })
    await screen.findByRole('button', { name: 'OpenAI Codex', pressed: true })

    await userEvent.click(claude)

    expect(await screen.findByRole('alert')).toHaveTextContent('Claude Code is not installed')
    expect(claude).toHaveAttribute('aria-pressed', 'false')
  })

  it('labels key availability instead of reusing workflow phases', async () => {
    mockSettings()
    render(<Settings />)
    expect(await screen.findByText('Key missing')).toBeInTheDocument()
    expect(screen.queryByText(/failed|succeeded/i)).not.toBeInTheDocument()
  })

  it('confirms before removing an account and reports failures', async () => {
    const fetchMock = mockSettings({ 'DELETE /api/settings/github-accounts/octocat': () => jsonResponse({ detail: 'Unable to remove' }, 500) })
    render(<Settings />)

    await userEvent.click(await screen.findByRole('button', { name: 'Remove octocat' }))
    expect(fetchMock).not.toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ method: 'DELETE' }))
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Remove account' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Unable to remove')
  })

  it('has no serious accessibility violations', async () => {
    mockSettings()
    const { container } = render(<Settings />)
    await screen.findByText('octocat')
    await expectNoSeriousAxeViolations(container)
  })
})
