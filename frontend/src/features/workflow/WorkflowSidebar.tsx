import type { Workflow } from '../../types'

export function WorkflowSidebar({ workflow }: { workflow: Workflow }) {
  const state = workflow.state ?? {}
  return <aside>
    <section className="card facts" aria-labelledby="run-details-title"><h2 id="run-details-title">Run details</h2>
      <dl><dt>Thread ID</dt><dd title={workflow.thread_id}>{workflow.thread_id.slice(0, 13)}…</dd>
        <dt>Design</dt><dd>v{workflow.current_design_version || '—'}</dd>
        <dt>Approved</dt><dd>{workflow.approved_design_version ? `v${workflow.approved_design_version}` : 'Pending'}</dd>
        <dt>Iterations</dt><dd>{String(state.development_iteration ?? 0)}</dd></dl>
    </section>
    <section className="card timeline" aria-labelledby="history-title"><h2 id="history-title">Execution history</h2>
      <ol>
        {(workflow.events ?? []).slice().reverse().map(event => <li className="event" key={event.id}>
          <span className="event-dot" aria-hidden="true" />
          <div><strong>{event.message}</strong>
            {typeof event.data.error === 'string' && event.data.error && <small>{event.data.error}</small>}
            <time dateTime={event.created_at}>{new Date(event.created_at).toLocaleString()}</time></div>
        </li>)}
      </ol>
    </section>
  </aside>
}
