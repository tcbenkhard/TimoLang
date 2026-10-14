import { ChevronRight } from 'lucide-react'
import { StatusPill } from '../../components/StatusPill'
import { progress, sourceHost } from '../../lib/workflow'
import { Link } from '../../router/Link'
import { paths } from '../../router/routes'
import type { Workflow } from '../../types'

export function WorkflowCard({ workflow }: { workflow: Workflow }) {
  return <Link className="workflow-card" to={paths.workflow(workflow.id)}>
    <div className="card-top"><StatusPill phase={workflow.phase} /><ChevronRight size={18} aria-hidden="true" /></div>
    <h3>{workflow.title ?? 'Resolving request…'}</h3>
    <p>{sourceHost(workflow)} · started {new Date(workflow.created_at).toLocaleString()}</p>
    <div className="progress" aria-hidden="true"><span style={{ width: `${progress(workflow.phase)}%` }} /></div>
    <div className="card-meta"><span>Design v{workflow.current_design_version || '—'}</span>
      <span>Updated {new Date(workflow.updated_at).toLocaleTimeString()}</span></div>
  </Link>
}
