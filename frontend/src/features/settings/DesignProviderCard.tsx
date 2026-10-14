import { useEffect, useState } from 'react'
import { api, errorMessage } from '../../api'
import { ErrorMessage } from '../../components/ErrorMessage'
import { ToggleGroup, type ToggleOption } from '../../components/ToggleGroup'
import { useAsyncAction } from '../../hooks/useAsyncAction'
import type { DesignProvider, DesignProviderSettings } from '../../types'

const providerNames: Record<DesignProvider, string> = { codex: 'OpenAI Codex', claude: 'Claude Code' }

export function DesignProviderCard() {
  const [settings, setSettings] = useState<DesignProviderSettings | null>(null)
  const [loadError, setLoadError] = useState('')
  const { pending, error, run } = useAsyncAction()

  useEffect(() => {
    let active = true
    api.designProvider().then(
      next => { if (active) setSettings(next) },
      problem => { if (active) setLoadError(errorMessage(problem, 'Unable to load the design provider.')) },
    )
    return () => { active = false }
  }, [])

  const options: ToggleOption<DesignProvider>[] = (['codex', 'claude'] as DesignProvider[]).map(provider => {
    const available = settings?.availability[provider] ?? false
    return {
      value: provider,
      label: settings && !available ? `${providerNames[provider]} · not installed` : providerNames[provider],
      disabled: !available,
    }
  })

  function select(provider: DesignProvider) {
    void run(async () => setSettings(await api.saveDesignProvider(provider)), 'Unable to save the design provider.')
  }

  return <section className="card settings-card" aria-labelledby="design-provider-title">
    <h2 id="design-provider-title">AI design provider</h2>
    <p>Select the locally installed CLI used to inspect repositories and generate designs. Sign in through the selected CLI; no API key is stored by Relay.</p>
    <ToggleGroup label="AI design provider" options={options} value={settings?.provider} onChange={select} disabled={pending} />
    <p className="security-note">Design runs are read-only. CLI login state remains managed by Codex or Claude Code on this machine.</p>
    <p className="security-note">On Windows, Relay automatically locates Codex's optional code-mode host and uses the workspace-write sandbox.</p>
    <ErrorMessage message={error || loadError} />
  </section>
}
