import { useCallback, useEffect, useRef, useState } from 'react'
import { api, ApiError, errorMessage } from '../api'
import type { Workflow } from '../types'

export interface WorkflowTransport {
  get: (id: string) => Promise<Workflow>
  stream: (id: string, onWorkflow: (workflow: Workflow) => void, signal: AbortSignal) => Promise<void>
}

export type LoadState = 'loading' | 'ready' | 'not-found' | 'error'
export type ConnectionState = 'connecting' | 'live' | 'reconnecting'

const defaultTransport: WorkflowTransport = { get: api.get, stream: api.streamWorkflow }
const maxReconnectDelay = 30_000

const isNotFound = (problem: unknown) => problem instanceof ApiError && problem.status === 404

/**
 * Live view of one workflow: an authenticated SSE stream with exponential reconnect backoff.
 * While the stream is down, the workflow is polled so the view never goes stale.
 * Mount with `key={id}` so switching workflows starts from a clean state.
 */
export function useWorkflow(id: string, { transport = defaultTransport, pollInterval = 3000 } = {}) {
  const [workflow, setWorkflow] = useState<Workflow | null>(null)
  const [loadState, setLoadState] = useState<LoadState>('loading')
  const [loadError, setLoadError] = useState('')
  const [connection, setConnection] = useState<ConnectionState>('connecting')
  const stopped = useRef(false)

  const applyWorkflow = useCallback((next: Workflow) => {
    setWorkflow(next)
    setLoadState('ready')
    setLoadError('')
  }, [])

  const markNotFound = useCallback(() => {
    stopped.current = true
    setLoadState('not-found')
  }, [])

  const handleLoadError = useCallback((problem: unknown) => {
    if (isNotFound(problem)) return markNotFound()
    setLoadError(errorMessage(problem, 'Unable to load this workflow.'))
    setLoadState(current => current === 'ready' ? current : 'error')
  }, [markNotFound])

  const refresh = useCallback(
    () => transport.get(id).then(applyWorkflow, handleLoadError),
    [id, transport, applyWorkflow, handleLoadError],
  )

  useEffect(() => {
    const controller = new AbortController()
    let live = false
    let attempt = 0
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined

    async function connect() {
      try {
        await transport.stream(id, next => {
          live = true
          attempt = 0
          setConnection('live')
          applyWorkflow(next)
        }, controller.signal)
      } catch (problem) {
        if (controller.signal.aborted) return
        if (isNotFound(problem)) return markNotFound()
      }
      if (controller.signal.aborted || stopped.current) return
      live = false
      attempt += 1
      setConnection('reconnecting')
      reconnectTimer = setTimeout(() => void connect(), Math.min(maxReconnectDelay, 1000 * 2 ** attempt))
    }

    const pollTimer = setInterval(() => {
      if (!live && !stopped.current) void refresh()
    }, pollInterval)
    void transport.get(id).then(applyWorkflow, handleLoadError).then(() => {
      if (!stopped.current && !controller.signal.aborted) void connect()
    })

    return () => {
      controller.abort()
      clearInterval(pollTimer)
      clearTimeout(reconnectTimer)
    }
  }, [id, transport, pollInterval, refresh, applyWorkflow, handleLoadError, markNotFound])

  return { workflow, loadState, loadError, connection, refresh }
}
