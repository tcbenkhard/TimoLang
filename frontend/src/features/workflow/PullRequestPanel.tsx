import { useState } from 'react'
import { ExternalLink, GitPullRequest } from 'lucide-react'
import { api } from '../../api'
import { ErrorMessage } from '../../components/ErrorMessage'
import { useAsyncAction } from '../../hooks/useAsyncAction'

export function PullRequestPanel({ workflowId, pullRequestUrl, onChanged }: {
  workflowId: string
  pullRequestUrl?: string
  onChanged: () => Promise<void>
}) {
  const [feedback, setFeedback] = useState('')
  const { pending, error, run } = useAsyncAction()

  async function update(merged: boolean) {
    const succeeded = await run(() => api.updatePr(workflowId, merged, feedback.trim() ? feedback : undefined),
      'Unable to update the pull request status.')
    if (succeeded) {
      setFeedback('')
      await onChanged()
    }
  }

  return <section className="approval card" aria-labelledby="pull-request-title" aria-busy={pending}>
    <div className="approval-banner purple"><GitPullRequest size={20} aria-hidden="true" /><div>
      <strong id="pull-request-title">Create and merge the pull request</strong>
      <span>The implementation branch is pushed. Create and review the pull request on GitHub, then confirm once it is merged.</span>
    </div></div>
    {pullRequestUrl && <a className="pr-link" href={pullRequestUrl} target="_blank" rel="noopener noreferrer">
      Create pull request on GitHub <ExternalLink size={15} aria-hidden="true" /></a>}
    <label className="field-label" htmlFor="pr-feedback">Review feedback</label>
    <textarea id="pr-feedback" value={feedback} maxLength={10_000} onChange={event => setFeedback(event.target.value)}
      placeholder="Optional feedback for the developer agent" />
    <div className="actions">
      <button type="button" className="primary" disabled={pending} onClick={() => void update(true)}>Confirm merged</button>
      <button type="button" disabled={pending} onClick={() => void update(false)}>Changes requested</button>
    </div>
    <ErrorMessage message={error} />
  </section>
}
