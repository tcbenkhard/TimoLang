import { describe, expect, it, vi } from 'vitest'
import { api, ApiError, networkErrorMessage, problemMessages } from './api'
import { jsonResponse, makeWorkflow, mockFetch, workflowId } from './test/fixtures'

describe('problemMessages', () => {
  it('maps FastAPI 422 validation issues to readable field messages', () => {
    const detail = [
      { loc: ['body', 'request_text'], msg: 'String should have at least 10 characters', type: 'string_too_short' },
      { loc: ['body'], msg: 'Value error, exactly one source is required', type: 'value_error' },
    ]
    expect(problemMessages(detail, 'fallback')).toEqual([
      'request_text: String should have at least 10 characters',
      'Value error, exactly one source is required',
    ])
  })

  it('passes string details through and falls back for unknown shapes', () => {
    expect(problemMessages('Workflow not found', 'fallback')).toEqual(['Workflow not found'])
    expect(problemMessages({ unexpected: true }, 'fallback')).toEqual(['fallback'])
    expect(problemMessages([], 'fallback')).toEqual(['fallback'])
  })
})

describe('api request errors', () => {
  it('throws an ApiError with readable messages for 422 responses', async () => {
    mockFetch({ 'POST /api/workflows': () => jsonResponse({ detail: [{ loc: ['body', 'test_id'], msg: 'Invalid' }] }, 422) })
    const error = await api.create({ test_id: '!' }).catch((problem: unknown) => problem)
    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({ status: 422, message: 'test_id: Invalid' })
    expect(String(error)).not.toContain('[object Object]')
  })

  it('falls back to the status text when the error body is not JSON', async () => {
    mockFetch({ 'GET /api/workflows': () => new Response('<html>', { status: 502, statusText: 'Bad Gateway' }) })
    await expect(api.list()).rejects.toMatchObject({ status: 502, message: 'Bad Gateway' })
  })

  it('reports network failures with a readable message', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))))
    await expect(api.list()).rejects.toMatchObject({ status: 0, message: networkErrorMessage })
  })
})

describe('api.streamWorkflow', () => {
  function streamOf(chunks: string[]) {
    const encoder = new TextEncoder()
    return new ReadableStream<Uint8Array>({
      start(controller) {
        chunks.forEach(chunk => controller.enqueue(encoder.encode(chunk)))
        controller.close()
      },
    })
  }

  it('parses workflow events and authenticates with a header, never the URL', async () => {
    const workflow = makeWorkflow({ phase: 'reviewing' })
    const payload = `event: workflow\ndata: ${JSON.stringify(workflow)}\n\n`
    const fetchMock = mockFetch({
      [`GET /api/workflows/${workflowId}/events`]: () => new Response(streamOf([': heartbeat\n\n', payload.slice(0, 20), payload.slice(20)])),
    })
    const received: string[] = []

    await api.streamWorkflow(workflowId, next => received.push(next.phase), new AbortController().signal)

    expect(received).toEqual(['reviewing'])
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).not.toMatch(/token/i)
    expect(new Headers(init?.headers).get('Authorization')).toMatch(/^Bearer .+/)
  })
})
