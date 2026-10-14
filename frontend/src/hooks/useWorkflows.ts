import { useEffect, useState } from 'react'
import { api } from '../api'
import type { Workflow } from '../types'

const pollInterval = 3000

/** Polls the workflow list while `enabled`; keeps the last known list otherwise. */
export function useWorkflows(enabled: boolean) {
  const [workflows, setWorkflows] = useState<Workflow[]>([])
  const [loaded, setLoaded] = useState(false)
  const [offline, setOffline] = useState(false)

  useEffect(() => {
    if (!enabled) return
    let active = true
    async function load() {
      try {
        const next = await api.list()
        if (!active) return
        setWorkflows(next)
        setOffline(false)
      } catch {
        if (active) setOffline(true)
      } finally {
        if (active) setLoaded(true)
      }
    }
    void load()
    const timer = setInterval(() => void load(), pollInterval)
    return () => { active = false; clearInterval(timer) }
  }, [enabled])

  return { workflows, loaded, offline }
}
