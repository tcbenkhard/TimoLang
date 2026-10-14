import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MarkdownDocument } from './MarkdownDocument'

const { renderMermaid } = vi.hoisted(() => ({ renderMermaid: vi.fn<(source: string) => Promise<string>>() }))
vi.mock('../lib/mermaid', () => ({ renderMermaid }))

beforeEach(() => {
  renderMermaid.mockReset()
})

describe('MarkdownDocument', () => {
  it('renders GFM tables as tables', () => {
    render(<MarkdownDocument>{'| Test | Traces to |\n|---|---|\n| Router | FAC-1 |'}</MarkdownDocument>)
    expect(screen.getByRole('table')).toBeInTheDocument()
    expect(screen.getByRole('cell', { name: 'FAC-1' })).toBeInTheDocument()
  })

  it('renders mermaid blocks as diagrams', async () => {
    renderMermaid.mockResolvedValue('<svg data-testid="diagram"><text>A</text></svg>')
    render(<MarkdownDocument>{'```mermaid\nflowchart TD\n  A --> B\n```'}</MarkdownDocument>)
    expect(await screen.findByTestId('diagram')).toBeInTheDocument()
    expect(renderMermaid).toHaveBeenCalledWith('flowchart TD\n  A --> B')
  })

  it('shows the diagram source when rendering fails', async () => {
    renderMermaid.mockRejectedValue(new Error('Parse error'))
    render(<MarkdownDocument>{'```mermaid\nflowchart TD\n  A -->\n```'}</MarkdownDocument>)
    expect(await screen.findByText(/could not be rendered/i)).toBeInTheDocument()
    expect(screen.getByText(/A -->/)).toBeInTheDocument()
  })

  it('keeps regular code blocks as code', () => {
    const { container } = render(<MarkdownDocument>{'```ts\nconst a = 1\n```'}</MarkdownDocument>)
    expect(container.querySelector('pre code')).toHaveTextContent('const a = 1')
    expect(renderMermaid).not.toHaveBeenCalled()
  })

  it('never renders raw HTML from untrusted content', () => {
    const { container } = render(<MarkdownDocument>
      {'<script>window.pwned = true</script>\n\n<img src="x" onerror="alert(1)">'}
    </MarkdownDocument>)
    expect(container.querySelector('script')).toBeNull()
    expect(container.querySelector('img')).toBeNull()
  })

  it('strips unsafe link protocols and isolates external links', () => {
    render(<MarkdownDocument>
      {'[bad](javascript:alert(1)) [data](data:text/html,x) [site](https://example.com) [anchor](#section)'}
    </MarkdownDocument>)
    expect(screen.getByText('bad').getAttribute('href') ?? '').toBe('')
    expect(screen.getByText('data').getAttribute('href') ?? '').toBe('')
    const external = screen.getByRole('link', { name: 'site' })
    expect(external).toHaveAttribute('rel', 'noopener noreferrer')
    expect(external).toHaveAttribute('target', '_blank')
    expect(screen.getByRole('link', { name: 'anchor' })).not.toHaveAttribute('target')
  })
})
