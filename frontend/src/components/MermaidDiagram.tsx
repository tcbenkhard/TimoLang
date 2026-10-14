import { useEffect, useState } from 'react'
import { renderMermaid } from '../lib/mermaid'

type DiagramState = { status: 'rendering' } | { status: 'rendered', svg: string } | { status: 'failed' }

/** Renders a Mermaid diagram; shows the source while loading and as a fallback on failure. */
export function MermaidDiagram({ source }: { source: string }) {
  const [state, setState] = useState<DiagramState>({ status: 'rendering' })

  useEffect(() => {
    let active = true
    renderMermaid(source).then(
      svg => { if (active) setState({ status: 'rendered', svg }) },
      () => { if (active) setState({ status: 'failed' }) },
    )
    return () => { active = false }
  }, [source])

  if (state.status === 'rendered') {
    // The SVG comes from Mermaid's sanitising render path with securityLevel 'strict'.
    return <figure className="diagram" dangerouslySetInnerHTML={{ __html: state.svg }} />
  }
  return <figure className="diagram-source" aria-busy={state.status === 'rendering'}>
    {state.status === 'failed' && <figcaption>This diagram could not be rendered. Showing its source instead.</figcaption>}
    <pre><code>{source}</code></pre>
  </figure>
}
