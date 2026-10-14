import { ArrowLeft, SearchX } from 'lucide-react'
import { Link } from '../router/Link'
import { paths } from '../router/routes'

export function NotFound({ message = 'This page does not exist.' }: { message?: string }) {
  return <main id="main" className="not-found">
    <div className="empty">
      <div className="empty-icon"><SearchX size={25} aria-hidden="true" /></div>
      <h1>Not found</h1>
      <p>{message}</p>
      <Link className="back" to={paths.dashboard}><ArrowLeft size={16} aria-hidden="true" /> Back to the dashboard</Link>
    </div>
  </main>
}
