import { useEffect, useId, useRef, useState } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'

const renderer = () => import('mermaid').then(({ default: mermaid }) => {
  mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'dark' })
  return mermaid
})
let mermaidLoader: ReturnType<typeof renderer> | undefined

function MermaidDiagram({ source }: { source: string }) {
  const container = useRef<HTMLDivElement>(null)
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, '')
  const [error, setError] = useState<string>()

  useEffect(() => {
    let cancelled = false
    const render = async () => {
      try {
        mermaidLoader ??= renderer()
        const mermaid = await mermaidLoader
        // Parse first so invalid diagrams do not leave Mermaid's error SVG in the page.
        await mermaid.parse(source)
        const { svg } = await mermaid.render(`design-diagram-${id}`, source)
        if (!cancelled && container.current) container.current.innerHTML = svg
      } catch {
        if (!cancelled) setError('Unable to render this flowchart. Check the diagram syntax below.')
      }
    }
    void render()
    return () => { cancelled = true }
  }, [id, source])

  return <div className="design-diagram">
    {error ? <><p role="alert">{error}</p><pre><code>{source}</code></pre></>
      : <div ref={container} role="img" aria-label="Design flowchart" />}
  </div>
}

const components: Components = {
  table({ children }) {
    return <div className="document-table"><table>{children}</table></div>
  },
  pre({ node, children, ...props }) {
    const code = node?.children[0]
    if (code?.type === 'element' && code.tagName === 'code'
      && Array.isArray(code.properties.className)
      && code.properties.className.includes('language-mermaid')) {
      const source = code.children.map(child => child.type === 'text' ? child.value : '').join('').trim()
      return <MermaidDiagram key={source} source={source} />
    }
    return <pre {...props}>{children}</pre>
  },
}

export default function DesignMarkdown({ children }: { children: string }) {
  return <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>{children}</ReactMarkdown>
}
