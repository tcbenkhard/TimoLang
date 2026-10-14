import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { WorkflowTransport } from '../../hooks/useWorkflow'
import { expectNoSeriousAxeViolations, jsonResponse, makeWorkflow, mockFetch, workflowId } from '../../test/fixtures'
import type { Workflow } from '../../types'
import { WorkflowDetailPage } from './WorkflowDetailPage'

const base = `/api/workflows/${workflowId}`

/** A stream that stays open until the view unmounts. */
function idleStream(_id: string, _onWorkflow: (workflow: Workflow) => void, signal: AbortSignal) {
  return new Promise<void>((_, reject) => signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError'))))
}

function transportFor(workflow: Workflow, stream: WorkflowTransport['stream'] = idleStream): WorkflowTransport {
  return { get: vi.fn(async () => workflow), stream: vi.fn(stream) }
}

async function renderDetail(workflow: Workflow, transport = transportFor(workflow)) {
  const view = render(<WorkflowDetailPage id={workflowId} transport={transport} />)
  await screen.findByRole('heading', { level: 1, name: workflow.title })
  return { ...view, transport }
}

async function confirmDialog(name: RegExp) {
  const dialog = await screen.findByRole('dialog')
  await userEvent.click(within(dialog).getByRole('button', { name }))
}

describe('WorkflowDetailPage live updates', () => {
  it('applies streamed updates and announces the new status', async () => {
    let push: (workflow: Workflow) => void = () => {}
    const transport = transportFor(makeWorkflow(), (_id, onWorkflow, signal) => {
      push = onWorkflow
      return idleStream(_id, onWorkflow, signal)
    })
    await renderDetail(makeWorkflow(), transport)
    await waitFor(() => expect(transport.stream).toHaveBeenCalled())

    act(() => push(makeWorkflow({ phase: 'reviewing' })))

    expect(await screen.findByText('Workflow status: reviewing')).toBeInTheDocument()
  })

  it('shows a reconnecting notice, polls, and backs off when the stream drops', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      const transport = transportFor(makeWorkflow(), async () => { throw new TypeError('network') })
      render(<WorkflowDetailPage id={workflowId} transport={transport} />)

      expect(await screen.findByText(/Reconnecting/)).toBeInTheDocument()
      const pollsBefore = vi.mocked(transport.get).mock.calls.length
      await act(() => vi.advanceTimersByTimeAsync(3100))
      expect(vi.mocked(transport.get).mock.calls.length).toBeGreaterThan(pollsBefore)
      expect(transport.stream).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('closes the stream on unmount', async () => {
    let streamSignal: AbortSignal | undefined
    const transport = transportFor(makeWorkflow(), (id, onWorkflow, signal) => {
      streamSignal = signal
      return idleStream(id, onWorkflow, signal)
    })
    const { unmount } = await renderDetail(makeWorkflow(), transport)
    await waitFor(() => expect(streamSignal).toBeDefined())

    unmount()

    expect(streamSignal?.aborted).toBe(true)
  })

  it('renders a not-found view for unknown workflows', async () => {
    mockFetch({})
    render(<WorkflowDetailPage id={workflowId} />)
    expect(await screen.findByRole('heading', { name: 'Not found' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /back to the dashboard/i })).toHaveAttribute('href', '/')
  })
})

describe('WorkflowDetailPage actions', () => {
  const failing = () => jsonResponse({ detail: 'Workflow is not awaiting design approval' }, 409)

  it.each([
    ['Approve design', `POST ${base}/design-review`],
    ['Confirm merged', `POST ${base}/pull-request`],
    ['Changes requested', `POST ${base}/pull-request`],
    ['Retry failed step', `POST ${base}/retry`],
    ['Restart', `POST ${base}/restart`],
  ])('shows the API error when "%s" fails and re-enables actions', async (label, route) => {
    const phase = label.includes('design') ? 'awaiting_design_approval'
      : label.includes('merged') || label.includes('Changes') ? 'awaiting_pr_merge' : 'failed'
    mockFetch({ [route]: failing })
    await renderDetail(makeWorkflow({ phase }))

    await userEvent.click(screen.getByRole('button', { name: label }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Workflow is not awaiting design approval')
    expect(screen.getByRole('button', { name: label })).toBeEnabled()
  })

  it('requires feedback before requesting design changes and reports failures', async () => {
    mockFetch({ [`POST ${base}/design-review`]: failing })
    await renderDetail(makeWorkflow({ phase: 'awaiting_design_approval' }))
    const requestChanges = screen.getByRole('button', { name: 'Request changes' })
    expect(requestChanges).toBeDisabled()

    await userEvent.type(screen.getByLabelText('Feedback for a revision'), 'Split the API module')
    await userEvent.click(requestChanges)

    expect(await screen.findByRole('alert')).toHaveTextContent('not awaiting design approval')
  })

  it('confirms before rejecting a design', async () => {
    const fetchMock = mockFetch({ [`POST ${base}/design-review`]: { ok: true } })
    const workflow = makeWorkflow({ phase: 'awaiting_design_approval' })
    await renderDetail(workflow)

    await userEvent.click(screen.getByRole('button', { name: 'Reject' }))
    expect(fetchMock).not.toHaveBeenCalled()
    await confirmDialog(/Reject design/)

    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce())
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toMatchObject({ action: 'reject' })
  })

  it('shows the API error when rejecting a design fails and re-enables actions', async () => {
    mockFetch({ [`POST ${base}/design-review`]: failing })
    await renderDetail(makeWorkflow({ phase: 'awaiting_design_approval' }))

    await userEvent.click(screen.getByRole('button', { name: 'Reject' }))
    await confirmDialog(/Reject design/)

    expect(await screen.findByRole('alert')).toHaveTextContent('Workflow is not awaiting design approval')
    expect(screen.getByRole('button', { name: 'Reject' })).toBeEnabled()
  })

  it('disables the pull request actions while a request is pending', async () => {
    let resolve: (response: Response) => void = () => {}
    mockFetch({ [`POST ${base}/pull-request`]: () => new Promise<Response>(done => { resolve = done }) })
    await renderDetail(makeWorkflow({ phase: 'awaiting_pr_merge', pull_request_url: 'https://github.com/acme/api/compare/x' }))

    await userEvent.click(screen.getByRole('button', { name: 'Confirm merged' }))

    expect(screen.getByRole('button', { name: 'Confirm merged' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Changes requested' })).toBeDisabled()
    expect(screen.getByRole('link', { name: /create pull request/i })).toHaveAttribute('rel', 'noopener noreferrer')
    await act(async () => resolve(jsonResponse({ ok: true })))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Confirm merged' })).toBeEnabled())
  })

  it('offers Cancel only for active workflows', async () => {
    const { unmount } = await renderDetail(makeWorkflow({ phase: 'succeeded' }))
    expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument()
    unmount()

    await renderDetail(makeWorkflow({ phase: 'developing' }))
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
  })

  it('cancels after confirmation and reports failures', async () => {
    const fetchMock = mockFetch({ [`POST ${base}/cancel`]: () => jsonResponse({ detail: 'Workflow operation failed' }, 500) })
    await renderDetail(makeWorkflow({ phase: 'developing' }))

    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await confirmDialog(/Cancel workflow/)

    expect(await screen.findByRole('alert')).toHaveTextContent('Workflow operation failed')
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining(`${base}/cancel`), expect.objectContaining({ method: 'POST' }))
  })

  it('removes after confirmation and reports failures', async () => {
    mockFetch({ [`DELETE ${base}`]: () => jsonResponse({ detail: 'Workflow operation failed' }, 500) })
    await renderDetail(makeWorkflow({ phase: 'failed' }))

    await userEvent.click(screen.getByRole('button', { name: 'Remove' }))
    await confirmDialog(/Remove workflow/)

    expect(await screen.findByRole('alert')).toHaveTextContent('Workflow operation failed')
  })

  it('has no serious accessibility violations', async () => {
    const { container } = await renderDetail(makeWorkflow({ phase: 'awaiting_design_approval' }))
    await expectNoSeriousAxeViolations(container)
  })
})
