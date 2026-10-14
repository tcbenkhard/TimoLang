import { ArrowLeft, KeyRound } from 'lucide-react'
import { Link } from '../../router/Link'
import { paths } from '../../router/routes'
import { DesignProviderCard } from './DesignProviderCard'
import { GitHubAccountsCard } from './GitHubAccountsCard'

export function Settings() {
  return <main id="main" className="settings-page">
    <Link className="back" to={paths.dashboard}><ArrowLeft size={16} aria-hidden="true" /> Dashboard</Link>
    <div className="settings-title"><div className="eyebrow"><KeyRound size={14} aria-hidden="true" /> Configuration</div>
      <h1>Settings</h1><p>Choose the local AI design provider and configure repository access.</p></div>
    <DesignProviderCard />
    <GitHubAccountsCard />
  </main>
}
