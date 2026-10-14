import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import App from './App'
import { expectNoSeriousAxeViolations, jsonResponse, makeWorkflow, mockFetch, workflowId } from './test/fixtures'

function mockBackend(overrides: Record<string, unknown> = {}) {
  return mockFetch({
    'GET /api/workflows': [makeWorkflow()],
    [`GET /api/workflows/${workflowId}`]: makeWorkflow(),
    [`GET /api/workflows/${workflowId}/events`]: () => new Response(new ReadableStream()),
    'GET /api/settings/github-accounts': [],
    'GET /api/settings/design-provider': { provider: 'codex', availability: { codex: true, claude: false } },
    ...overrides,
  })
}

function renderAt(path: string) {
  window.history.replaceState(null, '', path)
  return render(<App />)
}

describe('App routing', () => {
  it('renders the dashboard at /', async () => {
    mockBackend()
    renderAt('/')
    expect(await screen.findByRole('heading', { name: 'Improve the dashboard' })).toBeInTheDocument()
    expect(document.title).toBe('Workflows · Relay')
  })

  it('loads the workflow from the URL on reload', async () => {
    const fetchMock = mockBackend()
    renderAt(`/workflows/${workflowId}`)
    expect(await screen.findByRole('heading', { level: 1, name: 'Improve the dashboard' })).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining(`/api/workflows/${workflowId}`), expect.anything())
  })

  it('renders settings at /settings', async () => {
    mockBackend()
    renderAt('/settings')
    expect(screen.getByRole('heading', { level: 1, name: 'Settings' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Settings' })).toHaveAttribute('aria-current', 'page')
  })

  it('renders a not-found view for unknown paths', () => {
    mockBackend()
    renderAt('/does-not-exist')
    expect(screen.getByRole('heading', { name: 'Not found' })).toBeInTheDocument()
  })

  it('navigates with links and supports browser back', async () => {
    mockBackend()
    renderAt('/')
    await userEvent.click(await screen.findByRole('link', { name: /Improve the dashboard/ }))
    expect(window.location.pathname).toBe(`/workflows/${workflowId}`)
    expect(await screen.findByRole('link', { name: /All workflows/ })).toBeInTheDocument()

    await act(async () => {
      window.history.back()
      await new Promise(resolve => window.addEventListener('popstate', resolve, { once: true }))
    })

    expect(window.location.pathname).toBe('/')
    expect(screen.getByRole('heading', { name: 'Workflows' })).toBeInTheDocument()
  })

  it('shows an offline indicator when the API is unreachable', async () => {
    mockBackend({ 'GET /api/workflows': () => Promise.reject(new TypeError('Failed to fetch')) })
    renderAt('/')
    expect(await screen.findByText('API offline')).toBeInTheDocument()
  })
})

describe('Dashboard', () => {
  it('describes what Relay does without claiming deployment', async () => {
    mockBackend({ 'GET /api/workflows': [] })
    renderAt('/')
    expect(await screen.findByText(/Wrike task URL, a test issue ID, or a written request/)).toBeInTheDocument()
    expect(document.body).not.toHaveTextContent(/deployed|independently verified/i)
  })

  it('exposes the source selector as an accessible, keyboard-operable toggle group', async () => {
    mockBackend()
    renderAt('/')
    const group = screen.getByRole('group', { name: 'Issue source' })
    const wrike = screen.getByRole('button', { name: 'Wrike URL' })
    const text = screen.getByRole('button', { name: 'Text' })
    expect(group).toContainElement(wrike)
    expect(wrike).toHaveAttribute('aria-pressed', 'true')

    text.focus()
    await userEvent.keyboard('{Enter}')

    expect(text).toHaveAttribute('aria-pressed', 'true')
    expect(wrike).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByLabelText('Describe the work')).toHaveAttribute('maxlength', '20000')
  })

  it('shows readable validation errors and opens the new workflow on success', async () => {
    let attempts = 0
    mockBackend({
      'POST /api/workflows': () => (attempts++ === 0
        ? jsonResponse({ detail: [{ loc: ['body', 'test_id'], msg: 'String should match pattern' }] }, 422)
        : jsonResponse({ id: workflowId }, 202)),
    })
    renderAt('/')
    await userEvent.click(screen.getByRole('button', { name: 'Test issue' }))
    await userEvent.type(screen.getByLabelText('Start from a test issue'), 'DEMO-1')

    await userEvent.click(screen.getByRole('button', { name: 'Start workflow' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('test_id: String should match pattern')

    await userEvent.click(screen.getByRole('button', { name: 'Start workflow' }))
    expect(await screen.findByRole('link', { name: /All workflows/ })).toBeInTheDocument()
    expect(window.location.pathname).toBe(`/workflows/${workflowId}`)
  })

  it('has no serious accessibility violations', async () => {
    mockBackend()
    const { container } = renderAt('/')
    await screen.findByRole('heading', { name: 'Improve the dashboard' })
    await expectNoSeriousAxeViolations(container)
  })
})
