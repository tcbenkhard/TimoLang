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
  it('saves PAT credentials without requiring an SSH key', async () => {
    const fetchMock = mockSettings({
      'PUT /api/settings/github-accounts/hubot': {
        account: 'hubot', ssh_key_path: '', key_available: false, pat_configured: true, username: 'hubot-user',
      },
    })
    render(<Settings />)
    await screen.findByText('octocat')

    await userEvent.type(screen.getByLabelText('GitHub account'), 'hubot')
    await userEvent.type(screen.getByLabelText('GitHub username'), 'hubot-user')
    await userEvent.type(screen.getByLabelText('Personal access token (optional)'), 'test-pat')
    expect(screen.getByLabelText('SSH private key path')).not.toBeRequired()
    await userEvent.click(screen.getByRole('button', { name: 'Save account' }))

    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/github-accounts/hubot'), expect.objectContaining({
      method: 'PUT',
      body: JSON.stringify({ account: 'hubot', ssh_key_path: '', pat_token: 'test-pat', username: 'hubot-user' }),
    }))
    expect(screen.getByLabelText('Personal access token (optional)')).toHaveValue('')
  })

  it('selects an SSH key from the paths returned by the backend', async () => {
    mockSettings({ 'POST /api/settings/browse-ssh-key': { paths: ['/root/.ssh/id_hubot'] } })
    render(<Settings />)
    await userEvent.click(screen.getByRole('button', { name: 'Browse' }))
    await userEvent.selectOptions(await screen.findByLabelText('Select an SSH private key'), '/root/.ssh/id_hubot')
    expect(screen.getByLabelText('SSH private key path')).toHaveValue('/root/.ssh/id_hubot')
  })

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

  it('reports a failed account list load next to the list, not the form', async () => {
    mockSettings({ 'GET /api/settings/github-accounts': () => jsonResponse({ detail: 'Database unavailable' }, 500) })
    render(<Settings />)

    const list = screen.getByRole('region', { name: 'Configured GitHub accounts' })
    expect(await within(list).findByRole('alert')).toHaveTextContent('Database unavailable')
    const form = screen.getByRole('region', { name: 'Add or update account' })
    expect(within(form).queryByRole('alert')).not.toBeInTheDocument()
  })

  it('does not report a successful save as failed when the list reload fails', async () => {
    let listCalls = 0
    mockSettings({
      'GET /api/settings/github-accounts': () => (listCalls++ === 0 ? jsonResponse(accounts) : jsonResponse({ detail: 'Reload failed' }, 500)),
      'PUT /api/settings/github-accounts/hubot': { account: 'hubot', ssh_key_path: '/home/me/.ssh/id_hubot', key_available: true },
    })
    render(<Settings />)
    await screen.findByText('octocat')

    await userEvent.type(screen.getByLabelText('GitHub account'), 'hubot')
    await userEvent.type(screen.getByLabelText('SSH private key path'), '/home/me/.ssh/id_hubot')
    await userEvent.click(screen.getByRole('button', { name: 'Save account' }))

    const list = screen.getByRole('region', { name: 'Configured GitHub accounts' })
    expect(await within(list).findByRole('alert')).toHaveTextContent('Reload failed')
    expect(screen.queryByText(/Unable to save/)).not.toBeInTheDocument()
    expect(screen.getByLabelText('GitHub account')).toHaveValue('')
  })

  it('has no serious accessibility violations', async () => {
    mockSettings()
    const { container } = render(<Settings />)
    await screen.findByText('octocat')
    await expectNoSeriousAxeViolations(container)
  })
})
