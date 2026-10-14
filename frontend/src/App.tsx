import { useEffect } from 'react'
import { Hexagon, Settings2 } from 'lucide-react'
import { Dashboard } from './features/dashboard/Dashboard'
import { NotFound } from './features/NotFound'
import { Settings } from './features/settings/Settings'
import { WorkflowDetailPage } from './features/workflow/WorkflowDetailPage'
import { useWorkflows } from './hooks/useWorkflows'
import { isTerminal } from './lib/workflow'
import { Link } from './router/Link'
import { paths, type Route } from './router/routes'
import { useRoute } from './router/useRoute'

const pageTitles: Record<Route['name'], string> = {
  dashboard: 'Workflows',
  workflow: 'Workflow',
  settings: 'Settings',
  'not-found': 'Not found',
}

function RouteView({ route, workflows }: { route: Route, workflows: ReturnType<typeof useWorkflows> }) {
  switch (route.name) {
    case 'dashboard': return <Dashboard workflows={workflows.workflows} loaded={workflows.loaded} />
    case 'workflow': return <WorkflowDetailPage key={route.id} id={route.id} />
    case 'settings': return <Settings />
    case 'not-found': return <NotFound />
  }
}

export default function App() {
  const route = useRoute()
  const workflows = useWorkflows()
  const activeCount = workflows.workflows.filter(workflow => !isTerminal(workflow.phase)).length

  useEffect(() => { document.title = `${pageTitles[route.name]} · Relay` }, [route.name])

  return <div className="shell">
    <a className="skip-link" href="#main">Skip to content</a>
    <header>
      <Link className="brand" to={paths.dashboard} aria-label="Relay dashboard"><Hexagon size={25} aria-hidden="true" /><span>RELAY</span></Link>
      <nav aria-label="Main">
        <span className="live" role="status" data-offline={workflows.offline || undefined}>
          <i aria-hidden="true" /> {workflows.offline ? 'API offline' : `${activeCount} active`}
        </span>
        <Link className="icon-button" to={paths.settings} aria-label="Settings"
          aria-current={route.name === 'settings' ? 'page' : undefined}><Settings2 size={18} aria-hidden="true" /></Link>
      </nav>
    </header>
    <RouteView route={route} workflows={workflows} />
    <footer>Local-first · Human-governed · Durable by design</footer>
  </div>
}
