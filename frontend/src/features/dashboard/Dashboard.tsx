import { Activity, GitPullRequest } from 'lucide-react'
import type { Workflow } from '../../types'
import { LaunchForm } from './LaunchForm'
import { WorkflowCard } from './WorkflowCard'

function EmptyState() {
  return <div className="empty">
    <div className="empty-icon"><GitPullRequest size={25} aria-hidden="true" /></div>
    <h3>No workflows yet</h3>
    <p>Start from a Wrike task URL, a test issue ID, or a written request above to launch the first workflow.</p>
  </div>
}

export function Dashboard({ workflows, loaded }: { workflows: Workflow[], loaded: boolean }) {
  return <main id="main">
    <section className="hero">
      <div className="eyebrow"><Activity size={14} aria-hidden="true" /> Local orchestration control plane</div>
      <h1>Ship with agents.<br /><em>Stay in control.</em></h1>
      <p>
        Turn a Wrike task, test issue, or written request into a designed, implemented, and AI-reviewed
        pull request, with your approval at every gate.
      </p>
      <LaunchForm />
    </section>

    <section className="workflow-section" aria-labelledby="workflows-title">
      <div className="section-heading"><div><span className="kicker">Work queue</span><h2 id="workflows-title">Workflows</h2></div>
        <span className="count" aria-label={`${workflows.length} workflows`}>{workflows.length}</span></div>
      {!loaded ? <p className="muted" role="status">Loading workflows…</p>
        : workflows.length === 0 ? <EmptyState />
          : <div className="workflow-list">
            {workflows.map(workflow => <WorkflowCard key={workflow.id} workflow={workflow} />)}
          </div>}
    </section>
  </main>
}
