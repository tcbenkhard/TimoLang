import { describe, expect, it } from 'vitest'
import { createSseParser, type ServerSentEvent } from './sse'

describe('createSseParser', () => {
  it('emits complete frames across chunk boundaries and ignores comments', () => {
    const events: ServerSentEvent[] = []
    const parse = createSseParser(event => events.push(event))

    parse(': heartbeat\n\nevent: workflow\nda')
    parse('ta: {"a":1}\n\r\ndata: plain\n\n')

    expect(events).toEqual([
      { event: 'workflow', data: '{"a":1}' },
      { event: 'message', data: 'plain' },
    ])
  })
})
