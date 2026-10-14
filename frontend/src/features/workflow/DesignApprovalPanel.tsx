import { useState } from 'react'
import { Check, Clock3, X } from 'lucide-react'
import { api } from '../../api'
import { ConfirmDialog, type Confirmation } from '../../components/ConfirmDialog'
import { ErrorMessage } from '../../components/ErrorMessage'
import { MarkdownDocument } from '../../components/MarkdownDocument'
import { useAsyncAction } from '../../hooks/useAsyncAction'
import type { DesignVersion } from '../../types'

export function DesignApprovalPanel({ workflowId, design, onChanged }: {
  workflowId: string
  design: DesignVersion
  onChanged: () => Promise<void>
}) {
  const [feedback, setFeedback] = useState('')
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null)
  const { pending, error, run } = useAsyncAction()
  const hasFeedback = feedback.trim().length > 0

  async function review(action: 'approve' | 'request_changes' | 'reject') {
    const succeeded = await run(() => api.reviewDesign(workflowId, action, hasFeedback ? feedback : undefined),
      'Unable to submit the design review.')
    if (succeeded) {
      setFeedback('')
      await onChanged()
    }
  }

  return <section className="approval card" aria-labelledby="design-approval-title" aria-busy={pending}>
    <div className="approval-banner"><Clock3 size={20} aria-hidden="true" /><div>
      <strong id="design-approval-title">Your review is required</strong>
      <span>Development cannot begin until this design is explicitly approved.</span></div></div>
    <div className="document"><div className="document-head"><span>Design</span><b>Version {design.version}</b></div>
      <MarkdownDocument>{design.markdown}</MarkdownDocument></div>
    <label className="field-label" htmlFor="design-feedback">Feedback for a revision</label>
    <textarea id="design-feedback" value={feedback} maxLength={10_000} onChange={event => setFeedback(event.target.value)}
      aria-describedby="design-feedback-hint" placeholder="Describe what should change in the next version" />
    <p className="input-help" id="design-feedback-hint">Required when requesting changes.</p>
    <div className="actions">
      <button type="button" className="primary" disabled={pending} onClick={() => void review('approve')}>
        <Check size={17} aria-hidden="true" /> Approve design</button>
      <button type="button" disabled={pending || !hasFeedback} onClick={() => void review('request_changes')}>Request changes</button>
      <button type="button" className="danger-button" disabled={pending} onClick={() => setConfirmation({
        title: 'Reject this design?',
        message: 'Rejecting stops the workflow. Development will not start.',
        confirmLabel: 'Reject design',
        onConfirm: () => void review('reject'),
      })}><X size={16} aria-hidden="true" /> Reject</button>
    </div>
    <ErrorMessage message={error} />
    <ConfirmDialog confirmation={confirmation} onClose={() => setConfirmation(null)} />
  </section>
}
