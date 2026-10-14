import { useState } from 'react'
import { Ban, Play, RotateCcw, Trash2 } from 'lucide-react'
import { api } from '../../api'
import { ConfirmDialog, type Confirmation } from '../../components/ConfirmDialog'
import { ErrorMessage } from '../../components/ErrorMessage'
import { StatusPill } from '../../components/StatusPill'
import { useAsyncAction } from '../../hooks/useAsyncAction'
import { isTerminal } from '../../lib/workflow'
import { navigate, paths } from '../../router/routes'
import type { Workflow } from '../../types'

export function WorkflowControls({ workflow, onChanged }: { workflow: Workflow, onChanged: () => Promise<void> }) {
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null)
  const { pending, error, run } = useAsyncAction()

  async function perform(action: () => Promise<unknown>, fallback: string) {
    if (await run(action, fallback)) await onChanged()
  }

  async function restart() {
    await run(async () => {
      const { id } = await api.restart(workflow.id)
      if (id === workflow.id) await onChanged()
      else navigate(paths.workflow(id))
    }, 'Unable to restart the workflow.')
  }

  async function remove() {
    if (await run(() => api.remove(workflow.id), 'Unable to remove the workflow.')) {
      navigate(paths.dashboard, { replace: true })
    }
  }

  return <div className="detail-controls-wrap">
    <div className="detail-controls">
      <StatusPill phase={workflow.phase} />
      {workflow.phase === 'failed' && <button type="button" disabled={pending}
        onClick={() => void perform(() => api.retry(workflow.id), 'Unable to retry the failed step.')}>
        <Play size={14} aria-hidden="true" /> Retry failed step</button>}
      <button type="button" disabled={pending} onClick={() => void restart()}>
        <RotateCcw size={14} aria-hidden="true" /> Restart</button>
      {!isTerminal(workflow.phase) && <button type="button" className="danger-outline" disabled={pending} onClick={() => setConfirmation({
        title: 'Cancel this workflow?',
        message: 'The run stops at its current step. You can restart it later from its original input.',
        confirmLabel: 'Cancel workflow',
        onConfirm: () => void perform(() => api.cancel(workflow.id), 'Unable to cancel the workflow.'),
      })}><Ban size={14} aria-hidden="true" /> Cancel</button>}
      <button type="button" className="danger-outline" disabled={pending} onClick={() => setConfirmation({
        title: 'Remove this workflow?',
        message: 'This permanently removes the workflow, its checkpoints, and its workspace.',
        confirmLabel: 'Remove workflow',
        onConfirm: () => void remove(),
      })}><Trash2 size={14} aria-hidden="true" /> Remove</button>
    </div>
    <ErrorMessage message={error} />
    <ConfirmDialog confirmation={confirmation} onClose={() => setConfirmation(null)} />
  </div>
}
