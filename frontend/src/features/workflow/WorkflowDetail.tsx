import { Check, CircleAlert, ExternalLink, LoaderCircle } from 'lucide-react'
import { MarkdownDocument } from '../../components/MarkdownDocument'
import { phaseLabel } from '../../lib/workflow'
import type { Workflow } from '../../types'
import { DesignApprovalPanel } from './DesignApprovalPanel'
import { PullRequestPanel } from './PullRequestPanel'
import { WorkflowControls } from './WorkflowControls'
import { WorkflowOverview } from './WorkflowOverview'
import { WorkflowSidebar } from './WorkflowSidebar'

const waitingPhases = ['awaiting_design_approval', 'awaiting_pr_merge']

function StateCard({ workflow }: { workflow: Workflow }) {
  const icon = workflow.phase === 'succeeded' ? <Check size={25} />
    : workflow.phase === 'failed' ? <CircleAlert size={25} /> : <LoaderCircle className="spin" size={25} />
  const message = workflow.error || (workflow.phase === 'failed'
    ? 'The workflow failed without a recorded diagnostic. Restart it after updating the backend.'
    : 'Agents are advancing the workflow. State is checkpointed after each node.')
  return <section className={`card state-card ${workflow.phase}`}>
    <span aria-hidden="true">{icon}</span>
    <div><h2>{phaseLabel(workflow.phase)}</h2><p>{message}</p></div>
  </section>
}

export function WorkflowDetail({ workflow, onChanged }: { workflow: Workflow, onChanged: () => Promise<void> }) {
  // Designs are returned newest first.
  const design = workflow.designs?.[0]
  const state = workflow.state ?? {}
  const reviewFindings = Number(state.review_findings ?? 0)

  return <>
    <div className="detail-head">
      <div><span className="kicker">Workflow {workflow.id.slice(0, 8)}</span>
        <h1>{workflow.title ?? 'Resolving request…'}</h1>
        {state.source_kind === 'wrike' && <a href={workflow.wrike_url} target="_blank" rel="noopener noreferrer">
          Open Wrike task <ExternalLink size={13} aria-hidden="true" /></a>}</div>
      <WorkflowControls workflow={workflow} onChanged={onChanged} />
    </div>
    <p className="visually-hidden" aria-live="polite">Workflow status: {phaseLabel(workflow.phase)}</p>

    <div className="detail-grid">
      <div className="content-column">
        <WorkflowOverview workflow={workflow} />

        {workflow.phase === 'awaiting_design_approval' && design
          && <DesignApprovalPanel key={design.version} workflowId={workflow.id} design={design} onChanged={onChanged} />}

        {workflow.phase !== 'awaiting_design_approval' && design && <details className="card design-disclosure">
          <summary><span>{workflow.approved_design_version ? 'Approved design' : 'Design'}</span><b>Version {design.version}</b></summary>
          <div className="document"><MarkdownDocument>{design.markdown}</MarkdownDocument></div>
        </details>}

        {typeof state.review_markdown === 'string' && <details className="card design-disclosure">
          <summary><span>AI code review</span><b>{reviewFindings === 0 ? 'Passed' : `${reviewFindings} findings`}</b></summary>
          <div className="document"><MarkdownDocument>{state.review_markdown}</MarkdownDocument></div>
        </details>}

        {workflow.phase === 'awaiting_pr_merge'
          && <PullRequestPanel workflowId={workflow.id} pullRequestUrl={workflow.pull_request_url} onChanged={onChanged} />}

        {!waitingPhases.includes(workflow.phase) && <StateCard workflow={workflow} />}

        {typeof state.final_report === 'string' && <section className="card document" aria-label="Final report">
          <MarkdownDocument>{state.final_report}</MarkdownDocument></section>}
      </div>
      <WorkflowSidebar workflow={workflow} />
    </div>
  </>
}
