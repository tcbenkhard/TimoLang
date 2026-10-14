export interface ServerSentEvent {
  event: string
  data: string
}

/** Incremental parser for `text/event-stream` chunks; comments (heartbeats) are ignored. */
export function createSseParser(onEvent: (event: ServerSentEvent) => void) {
  let buffer = ''

  function dispatch(frame: string) {
    let event = 'message'
    const data: string[] = []
    for (const line of frame.split('\n')) {
      if (line.startsWith(':')) continue
      const separator = line.indexOf(':')
      const field = separator === -1 ? line : line.slice(0, separator)
      const value = separator === -1 ? '' : line.slice(separator + 1).replace(/^ /, '')
      if (field === 'event') event = value
      else if (field === 'data') data.push(value)
    }
    if (data.length > 0) onEvent({ event, data: data.join('\n') })
  }

  return (chunk: string) => {
    buffer += chunk.replaceAll('\r\n', '\n')
    let boundary = buffer.indexOf('\n\n')
    while (boundary !== -1) {
      dispatch(buffer.slice(0, boundary))
      buffer = buffer.slice(boundary + 2)
      boundary = buffer.indexOf('\n\n')
    }
  }
}
