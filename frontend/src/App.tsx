import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Activity, ArrowLeft, Check, ChevronRight, CircleAlert, Clock3,
  Circle, ExternalLink, FolderOpen, GitPullRequest, Hexagon, KeyRound, LoaderCircle, Play, Settings2, Trash2, X,
} from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import { api } from './api'
import type { DesignProvider, DesignProviderSettings, GitHubAccount, Phase, Workflow } from './types'

const terminal: Phase[] = ['succeeded', 'failed', 'cancelled']

const workflowSteps: { phase: Phase, label: string, detail: string }[] = [
  { phase: 'ingesting', label: 'Intake', detail: 'Normalize the request and inspect the repository' },
  { phase: 'designing', label: 'Design', detail: 'Prepare the functional and technical design' },
  { phase: 'awaiting_design_approval', label: 'Design approval', detail: 'Human review checkpoint' },
  { phase: 'developing', label: 'Implementation', detail: 'Implement, test, commit, and push the change' },
  { phase: 'reviewing', label: 'Review', detail: 'AI reviews the change and the developer applies its corrections' },
  { phase: 'awaiting_pr_merge', label: 'Pull request', detail: 'Create and merge the pull request' },
]

function phaseLabel(phase: Phase) {
  return phase.replaceAll('_', ' ')
}

function StatusPill({ phase }: { phase: Phase }) {
  const tone = phase === 'succeeded' ? 'success' : phase === 'failed' || phase === 'cancelled'
    ? 'danger' : phase.startsWith('awaiting') || phase === 'paused' ? 'warning' : 'active'
  return <span className={`status ${tone}`}><span />{phaseLabel(phase)}</span>
}

function EmptyState() {
  return <div className="empty">
    <div className="empty-icon"><GitPullRequest size={25} /></div>
    <h2>No workflows yet</h2>
    <p>Paste a Wrike task URL above to start the first durable engineering run.</p>
  </div>
}

function Dashboard({ workflows, onOpen, onCreated }: {
  workflows: Workflow[]
  onOpen: (id: string) => void
  onCreated: (id: string) => void
}) {
  const [url, setUrl] = useState('')
  const [mode, setMode] = useState<'wrike' | 'test' | 'text'>('wrike')
  const [project, setProject] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true); setError('')
    try {
      const source = mode === 'test' ? { test_id: url }
        : mode === 'text' ? { request_text: url }
          : { wrike_url: url }
      onCreated((await api.create({ ...source, project: project || undefined })).id)
      setUrl('')
    }
    catch (problem) { setError(problem instanceof Error ? problem.message : 'Unable to start') }
    finally { setBusy(false) }
  }

  return <main>
    <section className="hero">
      <div className="eyebrow"><Activity size={14} /> Local orchestration control plane</div>
      <h1>Ship with agents.<br /><em>Stay in control.</em></h1>
      <p>Turn a Wrike task into an inspected, reviewed, deployed, and independently verified change.</p>
      <form className="launch" onSubmit={submit}>
        <div className="launch-heading">
          <label htmlFor="workflow-source">{mode === 'test' ? 'Start from a fake issue' : mode === 'text' ? 'Describe the work' : 'Start from a Wrike task'}</label>
          <div className="mode-switch" aria-label="Issue source">
            <button type="button" className={mode === 'wrike' ? 'selected' : ''} onClick={() => { setMode('wrike'); setUrl('') }}>Wrike URL</button>
            <button type="button" className={mode === 'test' ? 'selected' : ''} onClick={() => { setMode('test'); setUrl('') }}>Test issue</button>
            <button type="button" className={mode === 'text' ? 'selected' : ''} onClick={() => { setMode('text'); setUrl('') }}>Text</button>
          </div>
        </div>
        {mode === 'text' && <textarea id="workflow-source" required minLength={10} value={url}
          onChange={e => setUrl(e.target.value)}
          placeholder="Describe the change, expected behavior, and acceptance criteria…" />}
        <div className="launch-row">
          {mode !== 'text' && <input id="workflow-source" type={mode === 'test' ? 'text' : 'url'} required value={url} onChange={e => setUrl(e.target.value)}
            pattern={mode === 'test' ? '[A-Za-z0-9_-]+' : undefined}
            placeholder={mode === 'test' ? 'e.g. DEMO-123' : 'https://www.wrike.com/open.htm?id=…'} />}
          <input className="project-input" value={project} onChange={e => setProject(e.target.value)} required={mode === 'text'}
            placeholder="Project/repository (e.g. acme/api)" aria-label="Project or repository" />
          <button className="primary" disabled={busy}>
            {busy ? <LoaderCircle className="spin" size={18} /> : <Play size={17} fill="currentColor" />}
            Start workflow
          </button>
        </div>
        {mode === 'text' && <p className="input-help">This request enters the normal approval workflow. A target repository is required.</p>}
        {error && <p className="form-error">{error}</p>}
      </form>
    </section>

    <section className="workflow-section">
      <div className="section-heading"><div><span className="kicker">Work queue</span><h2>Workflows</h2></div>
        <span className="count">{workflows.length}</span></div>
      {workflows.length === 0 ? <EmptyState /> : <div className="workflow-list">
        {workflows.map(workflow => <WorkflowCard key={workflow.id} workflow={workflow} onOpen={onOpen} />)}
      </div>}
    </section>
  </main>
}

function WorkflowCard({ workflow, onOpen }: { workflow: Workflow, onOpen: (id: string) => void }) {
  return <button className="workflow-card" onClick={() => onOpen(workflow.id)}>
    <div className="card-top"><StatusPill phase={workflow.phase} /><ChevronRight size={18} /></div>
    <h3>{workflow.title ?? 'Resolving Wrike task…'}</h3>
    <p>{new URL(workflow.wrike_url).hostname} · started {new Date(workflow.created_at).toLocaleString()}</p>
    <div className="progress"><span style={{ width: `${progress(workflow.phase)}%` }} /></div>
    <div className="card-meta"><span>Design v{workflow.current_design_version || '—'}</span>
      <span>Updated {new Date(workflow.updated_at).toLocaleTimeString()}</span></div>
  </button>
}

function Settings({ onBack }: { onBack: () => void }) {
  const [accounts, setAccounts] = useState<GitHubAccount[]>([])
  const [account, setAccount] = useState('')
  const [keyPath, setKeyPath] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [designProvider, setDesignProvider] = useState<DesignProviderSettings | null>(null)

  const loadAccounts = useCallback(async () => {
    try { setAccounts(await api.githubAccounts()); setError('') }
    catch (problem) { setError(problem instanceof Error ? problem.message : 'Unable to load settings') }
  }, [])

  useEffect(() => { const timer = setTimeout(() => void loadAccounts(), 0); return () => clearTimeout(timer) }, [loadAccounts])

  useEffect(() => {
    const timer = setTimeout(() => {
      void api.designProvider().then(setDesignProvider).catch(problem => {
        setError(problem instanceof Error ? problem.message : 'Unable to load design provider')
      })
    }, 0)
    return () => clearTimeout(timer)
  }, [])

  async function selectDesignProvider(provider: DesignProvider) {
    setBusy(true); setError('')
    try { setDesignProvider(await api.saveDesignProvider(provider)) }
    catch (problem) { setError(problem instanceof Error ? problem.message : 'Unable to save design provider') }
    finally { setBusy(false) }
  }

  async function save(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError('')
    try { await api.saveGithubAccount(account, keyPath); setAccount(''); setKeyPath(''); await loadAccounts() }
    catch (problem) { setError(problem instanceof Error ? problem.message : 'Unable to save account') }
    finally { setBusy(false) }
  }

  async function remove(name: string) {
    setBusy(true)
    try { await api.deleteGithubAccount(name); await loadAccounts() }
    finally { setBusy(false) }
  }

  async function browse() {
    setBusy(true); setError('')
    try {
      const result = await api.browseSshKey()
      if (result.path) setKeyPath(result.path)
    } catch (problem) { setError(problem instanceof Error ? problem.message : 'Unable to open file browser') }
    finally { setBusy(false) }
  }

  return <main className="settings-page">
    <button className="back" onClick={onBack}><ArrowLeft size={16} /> Dashboard</button>
    <div className="settings-title"><div className="eyebrow"><KeyRound size={14} /> Configuration</div>
      <h1>Settings</h1><p>Choose the local AI design provider and configure repository access.</p></div>
    <section className="card settings-card">
      <h2>AI design provider</h2>
      <p>Select the locally installed CLI used to inspect repositories and generate designs. Sign in through the selected CLI; no API key is stored by Relay.</p>
      <div className="mode-switch" aria-label="AI design provider">
        {(['codex', 'claude'] as DesignProvider[]).map(provider => <button type="button" key={provider}
          className={designProvider?.provider === provider ? 'selected' : ''}
          disabled={busy || !designProvider?.availability[provider]}
          onClick={() => void selectDesignProvider(provider)}>
          {provider === 'codex' ? 'OpenAI Codex' : 'Claude Code'}
          {designProvider && !designProvider.availability[provider] ? ' · not installed' : ''}
        </button>)}
      </div>
      <p className="security-note">Design runs are read-only. CLI login state remains managed by Codex or Claude Code on this machine.</p>
      <p className="security-note">On Windows, Relay automatically locates Codex's optional code-mode host and uses the workspace-write sandbox.</p>
    </section>
    <section className="card settings-card">
      <h2>Add or update account</h2>
      <form onSubmit={save} className="settings-form">
        <label>GitHub account<input required pattern="[A-Za-z0-9-]+" value={account} onChange={event => setAccount(event.target.value)} placeholder="tcbenkhard" /></label>
        <label>SSH private key path<div className="key-path-input"><input required value={keyPath} onChange={event => setKeyPath(event.target.value)} placeholder="/Users/me/.ssh/id_ed25519_tcbenkhard" /><button type="button" disabled={busy} onClick={() => void browse()} title="Browse for private key"><FolderOpen size={16} /> Browse</button></div></label>
        <button className="primary" disabled={busy}>Save account</button>
      </form>
      <p className="security-note">The chooser starts in your home directory. OpenSSH keys without an extension and .pem, .key, or .priv files are accepted; .pub and .ppk files are excluded. Only the path is stored.</p>
      {error && <p className="form-error">{error}</p>}
    </section>
    <section className="account-list">
      {accounts.map(item => <div className="card account-row" key={item.account}>
        <div><strong>{item.account}</strong><code>{item.ssh_key_path}</code></div>
        <div className="account-actions"><StatusPill phase={item.key_available ? 'succeeded' : 'failed'} />
          <button disabled={busy} onClick={() => void remove(item.account)} title="Remove account"><Trash2 size={16} /></button></div>
      </div>)}
      {accounts.length === 0 && <div className="empty"><p>No GitHub accounts configured.</p></div>}
    </section>
  </main>
}

function progress(phase: Phase) {
  const phases: Phase[] = [...workflowSteps.map(step => step.phase), 'succeeded']
  const index = phases.indexOf(phase)
  return phase === 'failed' || phase === 'cancelled' ? 100 : Math.max(5, (index / (phases.length - 1)) * 100)
}

function WorkflowOverview({ workflow }: { workflow: Workflow }) {
  const eventPhases = (workflow.events ?? []).map(event => event.phase)
  const recordedIndex = Math.max(-1, ...eventPhases.map(phase => workflowSteps.findIndex(step => step.phase === phase)))
  const directIndex = workflowSteps.findIndex(step => step.phase === workflow.phase)
  const currentIndex = workflow.phase === 'paused'
    ? Math.max(workflowSteps.findIndex(step => step.phase === 'developing'), recordedIndex)
    : directIndex >= 0 ? directIndex : recordedIndex
  const completedRun = workflow.phase === 'succeeded'
  const stoppedRun = workflow.phase === 'failed' || workflow.phase === 'cancelled'

  return <section className="card workflow-overview" aria-labelledby="workflow-overview-title">
    <div className="workflow-overview-head">
      <div><span className="kicker">Process overview</span><h2 id="workflow-overview-title">The whole workflow</h2></div>
      <span className="step-count">{completedRun ? workflowSteps.length : Math.max(1, currentIndex + 1)} / {workflowSteps.length}</span>
    </div>
    <ol className="workflow-steps">
      {workflowSteps.map((step, index) => {
        const state = completedRun || index < currentIndex ? 'complete'
          : index === currentIndex ? (stoppedRun ? 'stopped' : 'current') : 'upcoming'
        return <li className={`workflow-step ${state}`} key={step.phase} aria-current={state === 'current' ? 'step' : undefined}>
          <div className="step-marker">
            {state === 'complete' ? <Check size={14} />
              : state === 'current' ? <LoaderCircle className="spin" size={15} />
                : state === 'stopped' ? <X size={14} /> : <Circle size={13} />}
          </div>
          <div className="step-copy"><strong>{step.label}</strong><span>{step.detail}</span></div>
          <span className="step-state">{state === 'complete' ? 'Done' : state === 'current' ? 'Current' : state === 'stopped' ? phaseLabel(workflow.phase) : 'Coming up'}</span>
        </li>
      })}
    </ol>
  </section>
}

function Detail({ workflow, onBack, onRestart, onRetry, onDelete, refresh }: {
  workflow: Workflow
  onBack: () => void
  onRestart: () => Promise<void>
  onRetry: () => Promise<void>
  onDelete: () => Promise<void>
  refresh: () => Promise<void>
}) {
  const [feedback, setFeedback] = useState('')
  const [busy, setBusy] = useState(false)
  const design = workflow.designs?.[0]
  const state = workflow.state ?? {}

  async function act(action: () => Promise<unknown>) {
    setBusy(true)
    try { await action(); setFeedback(''); await refresh() } finally { setBusy(false) }
  }

  async function runLifecycle(action: () => Promise<void>) {
    setBusy(true)
    try { await action() } finally { setBusy(false) }
  }

  return <main className="detail">
    <button className="back" onClick={onBack}><ArrowLeft size={16} /> All workflows</button>
    <div className="detail-head">
      <div><span className="kicker">Workflow {workflow.id.slice(0, 8)}</span>
        <h1>{workflow.title ?? 'Resolving task…'}</h1>
        {state.source_kind === 'wrike' && <a href={workflow.wrike_url} target="_blank">Open Wrike task <ExternalLink size={13} /></a>}</div>
      <div className="detail-controls"><StatusPill phase={workflow.phase} />
        {workflow.phase === 'failed' && <button disabled={busy} onClick={() => void runLifecycle(onRetry)}><Play size={14} /> Retry failed step</button>}
        <button disabled={busy} onClick={() => void runLifecycle(onRestart)}><Play size={14} /> Restart</button>
        <button className="delete-workflow" disabled={busy} onClick={() => {
          if (window.confirm('Permanently remove this workflow, its checkpoints, and workspace?')) void runLifecycle(onDelete)
        }}><Trash2 size={14} /> Remove</button></div>
    </div>

    <div className="detail-grid">
      <div className="content-column">
        <WorkflowOverview workflow={workflow} />

        {workflow.phase === 'awaiting_design_approval' && design && <section className="approval card">
          <div className="approval-banner"><Clock3 size={20} /><div><strong>Your review is required</strong>
            <span>Development cannot begin until this design is explicitly approved.</span></div></div>
          <div className="document"><div className="document-head"><span>Design</span><b>Version {design.version}</b></div>
            <ReactMarkdown>{design.markdown}</ReactMarkdown></div>
          <textarea value={feedback} onChange={e => setFeedback(e.target.value)}
            placeholder="Feedback for a revision (required when requesting changes)" />
          <div className="actions">
            <button className="primary" disabled={busy} onClick={() => act(() => api.reviewDesign(workflow.id, 'approve'))}><Check size={17} /> Approve design</button>
            <button disabled={busy || !feedback.trim()} onClick={() => act(() => api.reviewDesign(workflow.id, 'request_changes', feedback))}>Request changes</button>
            <button className="danger-button" disabled={busy} onClick={() => act(() => api.reviewDesign(workflow.id, 'reject'))}><X size={16} /> Reject</button>
          </div>
        </section>}

        {workflow.phase !== 'awaiting_design_approval' && design && <details className="card design-disclosure">
          <summary><span>{workflow.approved_design_version ? 'Approved design' : 'Design'}</span><b>Version {design.version}</b></summary>
          <div className="document"><ReactMarkdown>{design.markdown}</ReactMarkdown></div>
        </details>}

        {typeof state.review_markdown === 'string' && <details className="card design-disclosure">
          <summary><span>AI code review</span><b>{Number(state.review_findings ?? 0) === 0 ? 'Passed' : `${String(state.review_findings)} findings`}</b></summary>
          <div className="document"><ReactMarkdown>{state.review_markdown}</ReactMarkdown></div>
        </details>}

        {workflow.phase === 'awaiting_pr_merge' && <section className="approval card">
          <div className="approval-banner purple"><GitPullRequest size={20} /><div><strong>Create and merge the pull request</strong>
            <span>The implementation branch is pushed. Create and review the pull request on GitHub, then confirm once it is merged.</span></div></div>
          {workflow.pull_request_url && <a className="pr-link" href={workflow.pull_request_url} target="_blank">Create pull request on GitHub <ExternalLink size={15} /></a>}
          <textarea value={feedback} onChange={e => setFeedback(e.target.value)} placeholder="Optional review feedback" />
          <div className="actions"><button className="primary" onClick={() => act(() => api.updatePr(workflow.id, true))}>Confirm merged</button>
            <button onClick={() => act(() => api.updatePr(workflow.id, false, feedback))}>Changes requested</button></div>
        </section>}

        {!['awaiting_design_approval', 'awaiting_pr_merge'].includes(workflow.phase) && <section className="card state-card">
          {workflow.phase === 'succeeded' ? <Check size={25} /> : workflow.phase === 'failed' ? <CircleAlert size={25} /> : <LoaderCircle className="spin" size={25} />}
          <div><h2>{phaseLabel(workflow.phase)}</h2><p>{workflow.error || (workflow.phase === 'failed' ? 'The workflow failed without a recorded diagnostic. Restart it after updating the backend.' : 'Agents are advancing the workflow. State is checkpointed after each node.')}</p></div>
        </section>}

        {typeof state.final_report === 'string' && <section className="card document"><ReactMarkdown>{state.final_report}</ReactMarkdown></section>}
      </div>

      <aside>
        <section className="card facts"><h2>Run details</h2>
          <dl><dt>Thread ID</dt><dd>{workflow.thread_id.slice(0, 13)}…</dd>
            <dt>Design</dt><dd>v{workflow.current_design_version || '—'}</dd>
            <dt>Approved</dt><dd>{workflow.approved_design_version ? `v${workflow.approved_design_version}` : 'Pending'}</dd>
            <dt>Iterations</dt><dd>{String(state.development_iteration ?? 0)}</dd></dl>
        </section>
        <section className="card timeline"><h2>Execution history</h2>
          {(workflow.events ?? []).slice().reverse().map(event => <div className="event" key={event.id}>
            <span className="event-dot" /><div><strong>{event.message}</strong>{typeof event.data.error === 'string' && event.data.error && <small>{event.data.error}</small>}<time>{new Date(event.created_at).toLocaleString()}</time></div>
          </div>)}
        </section>
      </aside>
    </div>
  </main>
}

export default function App() {
  const [workflows, setWorkflows] = useState<Workflow[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [detail, setDetail] = useState<Workflow | null>(null)
  const [offline, setOffline] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)

  const load = useCallback(async () => {
    try {
      if (selected) setDetail(await api.get(selected))
      else setWorkflows(await api.list())
      setOffline(false)
    } catch { setOffline(true) }
  }, [selected])

  useEffect(() => {
    const initial = setTimeout(() => void load(), 0)
    const timer = setInterval(() => void load(), 3000)
    return () => { clearTimeout(initial); clearInterval(timer) }
  }, [load])
  const activeCount = useMemo(() => workflows.filter(w => !terminal.includes(w.phase)).length, [workflows])

  return <div className="shell">
    <header><button className="brand" onClick={() => { setSettingsOpen(false); setSelected(null) }}><Hexagon size={25} /><span>RELAY</span></button>
      <nav><span className="live"><i /> {offline ? 'API offline' : `${activeCount} active`}</span><button title="Settings" onClick={() => setSettingsOpen(true)}><Settings2 size={18} /></button></nav>
    </header>
    {settingsOpen ? <Settings onBack={() => setSettingsOpen(false)} />
      : selected && detail ? <Detail workflow={detail}
        onBack={() => { setSelected(null); setDetail(null) }}
        onRestart={async () => { const result = await api.restart(detail.id); setDetail(null); setSelected(result.id) }}
        onRetry={async () => { await api.retry(detail.id); setDetail(await api.get(detail.id)) }}
        onDelete={async () => { await api.remove(detail.id); setSelected(null); setDetail(null); setWorkflows(await api.list()) }}
        refresh={load} />
      : <Dashboard workflows={workflows} onOpen={id => { setDetail(null); setSelected(id) }} onCreated={id => { setDetail(null); setSelected(id) }} />}
    <footer>Local-first · Human-governed · Durable by design</footer>
  </div>
}
