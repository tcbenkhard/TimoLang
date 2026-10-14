import type { MermaidConfig } from 'mermaid'

/**
 * Design documents are AI output derived from untrusted ticket and repository content:
 * `strict` disables HTML labels and click handlers, and the output is sanitised by Mermaid.
 */
export const mermaidConfig: MermaidConfig = {
  startOnLoad: false,
  securityLevel: 'strict',
  suppressErrorRendering: true,
  theme: 'dark',
}

let renderer: Promise<typeof import('mermaid').default> | null = null

/** Lazily loads Mermaid (a large bundle) the first time a diagram is rendered. */
export function loadMermaid() {
  renderer ??= import('mermaid').then(({ default: mermaid }) => {
    mermaid.initialize(mermaidConfig)
    return mermaid
  })
  return renderer
}

let diagramCount = 0

export async function renderMermaid(source: string) {
  const mermaid = await loadMermaid()
  diagramCount += 1
  const { svg } = await mermaid.render(`mermaid-diagram-${diagramCount}`, source)
  return svg
}
