import { phaseLabel, phaseTone } from '../lib/workflow'
import type { Phase } from '../types'
import { Badge } from './Badge'

export function StatusPill({ phase }: { phase: Phase }) {
  return <Badge tone={phaseTone(phase)}>{phaseLabel(phase)}</Badge>
}
