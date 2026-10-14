import { describe, expect, it, vi } from 'vitest'

const { initialize, render } = vi.hoisted(() => ({
  initialize: vi.fn(),
  render: vi.fn<(id: string, source: string) => Promise<{ svg: string }>>(async () => ({ svg: '<svg></svg>' })),
}))
vi.mock('mermaid', () => ({ default: { initialize, render } }))

describe('mermaid loader', () => {
  it('initialises Mermaid once with strict security', async () => {
    const { renderMermaid } = await import('./mermaid')

    await renderMermaid('flowchart TD\n A --> B')
    await renderMermaid('flowchart TD\n B --> C')

    expect(initialize).toHaveBeenCalledTimes(1)
    expect(initialize).toHaveBeenCalledWith(expect.objectContaining({ securityLevel: 'strict', startOnLoad: false }))
    expect(render.mock.calls.map(([id]) => id)).toEqual(['mermaid-diagram-1', 'mermaid-diagram-2'])
  })
})
