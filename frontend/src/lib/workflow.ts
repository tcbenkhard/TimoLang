import type { Phase, Workflow } from '../types'

export const terminalPhases: Phase[] = ['succeeded', 'failed', 'cancelled']

export const workflowSteps: { phase: Phase, label: string, detail: string }[] = [
  { phase: 'ingesting', label: 'Intake', detail: 'Normalize the request and inspect the repository' },
  { phase: 'designing', label: 'Design', detail: 'Prepare the functional and technical design' },
  { phase: 'awaiting_design_approval', label: 'Design approval', detail: 'Human review checkpoint' },
  { phase: 'developing', label: 'Implementation', detail: 'Implement, test, commit, and push the change' },
  { phase: 'reviewing', label: 'Review', detail: 'AI reviews the change and the developer applies its corrections' },
  { phase: 'awaiting_pr_merge', label: 'Pull request', detail: 'Create and merge the pull request' },
]

export type PhaseTone = 'success' | 'danger' | 'warning' | 'active'

export function isTerminal(phase: Phase) {
  return terminalPhases.includes(phase)
}

export function phaseLabel(phase: Phase) {
  return phase.replaceAll('_', ' ')
}

export function phaseTone(phase: Phase): PhaseTone {
  if (phase === 'succeeded') return 'success'
  if (phase === 'failed' || phase === 'cancelled') return 'danger'
  if (phase.startsWith('awaiting') || phase === 'paused') return 'warning'
  return 'active'
}

export function progress(phase: Phase) {
  if (phase === 'failed' || phase === 'cancelled') return 100
  const phases: Phase[] = [...workflowSteps.map(step => step.phase), 'succeeded']
  return Math.max(5, (phases.indexOf(phase) / (phases.length - 1)) * 100)
}

export function sourceHost(workflow: Workflow) {
  try { return new URL(workflow.wrike_url).hostname }
  catch { return 'unknown source' }
}
