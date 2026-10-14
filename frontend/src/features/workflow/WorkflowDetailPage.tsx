import { ArrowLeft, WifiOff } from 'lucide-react'
import { ErrorMessage } from '../../components/ErrorMessage'
import { useWorkflow, type WorkflowTransport } from '../../hooks/useWorkflow'
import { Link } from '../../router/Link'
import { paths } from '../../router/routes'
import { NotFound } from '../NotFound'
import { WorkflowDetail } from './WorkflowDetail'

/** Route-level container; mount with `key={id}` so each workflow gets fresh state. */
export function WorkflowDetailPage({ id, transport }: { id: string, transport?: WorkflowTransport }) {
  const { workflow, loadState, loadError, connection, refresh } = useWorkflow(id, { transport })

  if (loadState === 'not-found') return <NotFound message="This workflow does not exist or has been removed." />

  return <main id="main" className="detail">
    <Link className="back" to={paths.dashboard}><ArrowLeft size={16} aria-hidden="true" /> All workflows</Link>
    {connection === 'reconnecting' && <p className="connection-notice" role="status">
      <WifiOff size={15} aria-hidden="true" /> Live updates interrupted. Reconnecting…
    </p>}
    {!workflow
      ? loadState === 'error' ? <ErrorMessage message={loadError} /> : <p className="muted" role="status">Loading workflow…</p>
      : <WorkflowDetail workflow={workflow} onChanged={refresh} />}
  </main>
}
