import { Check, Circle, LoaderCircle, X } from 'lucide-react'
import { phaseLabel, workflowSteps } from '../../lib/workflow'
import type { Phase, Workflow } from '../../types'

type StepState = 'complete' | 'current' | 'stopped' | 'upcoming'

const stepIndex = (phase: Phase) => workflowSteps.findIndex(step => step.phase === phase)

function currentStepIndex(workflow: Workflow) {
  const recordedIndex = Math.max(-1, ...(workflow.events ?? []).map(event => stepIndex(event.phase)))
  if (workflow.phase === 'paused') return Math.max(stepIndex('developing'), recordedIndex)
  const directIndex = stepIndex(workflow.phase)
  return directIndex >= 0 ? directIndex : recordedIndex
}

function StepMarker({ state }: { state: StepState }) {
  if (state === 'complete') return <Check size={14} />
  if (state === 'current') return <LoaderCircle className="spin" size={15} />
  if (state === 'stopped') return <X size={14} />
  return <Circle size={13} />
}

export function WorkflowOverview({ workflow }: { workflow: Workflow }) {
  const currentIndex = currentStepIndex(workflow)
  const completedRun = workflow.phase === 'succeeded'
  const stoppedRun = workflow.phase === 'failed' || workflow.phase === 'cancelled'
  const stateLabels: Record<StepState, string> = {
    complete: 'Done', current: 'Current', stopped: phaseLabel(workflow.phase), upcoming: 'Coming up',
  }

  return <section className="card workflow-overview" aria-labelledby="workflow-overview-title">
    <div className="workflow-overview-head">
      <div><span className="kicker">Process overview</span><h2 id="workflow-overview-title">The whole workflow</h2></div>
      <span className="step-count">
        Step {completedRun ? workflowSteps.length : Math.max(1, currentIndex + 1)} of {workflowSteps.length}
      </span>
    </div>
    <ol className="workflow-steps">
      {workflowSteps.map((step, index) => {
        const state: StepState = completedRun || index < currentIndex ? 'complete'
          : index === currentIndex ? (stoppedRun ? 'stopped' : 'current') : 'upcoming'
        return <li className={`workflow-step ${state}`} key={step.phase} aria-current={state === 'current' ? 'step' : undefined}>
          <div className="step-marker" aria-hidden="true"><StepMarker state={state} /></div>
          <div className="step-copy"><strong>{step.label}</strong><span>{step.detail}</span></div>
          <span className="step-state">{stateLabels[state]}</span>
        </li>
      })}
    </ol>
  </section>
}
