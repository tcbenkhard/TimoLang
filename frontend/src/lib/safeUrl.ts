import { defaultUrlTransform } from 'react-markdown'

const allowedProtocol = /^(https?:|mailto:)/i
const anyProtocol = /^[a-z][a-z0-9+.-]*:/i

/** Allows only http(s), mailto, and relative URLs on top of react-markdown's default filtering. */
export function safeUrl(url: string) {
  const sanitized = defaultUrlTransform(url)
  return allowedProtocol.test(sanitized) || !anyProtocol.test(sanitized) ? sanitized : ''
}
