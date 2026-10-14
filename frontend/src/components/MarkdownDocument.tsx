import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { safeUrl } from '../lib/safeUrl'
import { MermaidDiagram } from './MermaidDiagram'

interface HastNode {
  tagName?: string
  value?: string
  properties?: { className?: unknown }
  children?: HastNode[]
}

function mermaidSource(node: HastNode | undefined) {
  const code = node?.children?.[0]
  const className = code?.properties?.className
  if (code?.tagName !== 'code' || !Array.isArray(className) || !className.includes('language-mermaid')) return null
  return (code.children ?? []).map(child => child.value ?? '').join('').trimEnd()
}

const components: Components = {
  a: ({ href, title, children }) => {
    // safeUrl blanks disallowed URLs; render their text without a broken link.
    if (!href) return <span title={title}>{children}</span>
    return /^https?:/i.test(href)
      ? <a href={href} title={title} target="_blank" rel="noopener noreferrer">{children}</a>
      : <a href={href} title={title}>{children}</a>
  },
  pre: ({ node, children }) => {
    const source = mermaidSource(node as HastNode | undefined)
    return source === null ? <pre>{children}</pre> : <MermaidDiagram key={source} source={source} />
  },
}

/**
 * Renders AI-generated Markdown with GFM tables and Mermaid diagrams. Raw HTML is never
 * rendered (no rehype-raw), so untrusted content cannot inject markup or scripts.
 */
export function MarkdownDocument({ children }: { children: string }) {
  return <ReactMarkdown remarkPlugins={[remarkGfm]} components={components} urlTransform={safeUrl}>
    {children}
  </ReactMarkdown>
}
