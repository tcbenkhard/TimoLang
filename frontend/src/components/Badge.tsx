import type { ReactNode } from 'react'
import type { PhaseTone } from '../lib/workflow'

export function Badge({ tone, children }: { tone: PhaseTone, children: ReactNode }) {
  return <span className={`status ${tone}`}><span aria-hidden="true" />{children}</span>
}
