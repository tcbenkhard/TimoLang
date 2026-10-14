import { useState, type FormEvent } from 'react'
import { LoaderCircle, Play } from 'lucide-react'
import { api, type WorkflowSource } from '../../api'
import { ErrorMessage } from '../../components/ErrorMessage'
import { ToggleGroup, type ToggleOption } from '../../components/ToggleGroup'
import { useAsyncAction } from '../../hooks/useAsyncAction'
import { navigate, paths } from '../../router/routes'

type SourceMode = 'wrike' | 'test' | 'text'

const sourceOptions: ToggleOption<SourceMode>[] = [
  { value: 'wrike', label: 'Wrike URL' },
  { value: 'test', label: 'Test issue' },
  { value: 'text', label: 'Text' },
]

const sourceHeadings: Record<SourceMode, string> = {
  wrike: 'Start from a Wrike task',
  test: 'Start from a test issue',
  text: 'Describe the work',
}

function toSource(mode: SourceMode, value: string): WorkflowSource {
  if (mode === 'test') return { test_id: value }
  if (mode === 'text') return { request_text: value }
  return { wrike_url: value }
}

export function LaunchForm() {
  const [mode, setMode] = useState<SourceMode>('wrike')
  const [source, setSource] = useState('')
  const [project, setProject] = useState('')
  const { pending, error, run, clearError } = useAsyncAction()

  function selectMode(next: SourceMode) {
    setMode(next)
    setSource('')
    clearError()
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    await run(async () => {
      const { id } = await api.create({ ...toSource(mode, source.trim()), project: project.trim() || undefined })
      navigate(paths.workflow(id))
    }, 'Unable to start the workflow.')
  }

  return <form className="launch" onSubmit={submit} aria-busy={pending}>
    <div className="launch-heading">
      <label htmlFor="workflow-source">{sourceHeadings[mode]}</label>
      <ToggleGroup label="Issue source" options={sourceOptions} value={mode} onChange={selectMode} disabled={pending} />
    </div>
    {mode === 'text' && <textarea id="workflow-source" required minLength={10} maxLength={20_000} value={source}
      aria-describedby="workflow-source-help"
      onChange={event => setSource(event.target.value)}
      placeholder="Describe the change, expected behavior, and acceptance criteria…" />}
    <div className="launch-row">
      {mode === 'wrike' && <input id="workflow-source" type="url" required value={source}
        onChange={event => setSource(event.target.value)}
        placeholder="https://www.wrike.com/open.htm?id=…" />}
      {mode === 'test' && <input id="workflow-source" type="text" required maxLength={64} pattern="[A-Za-z0-9_\-]+"
        title="Letters, numbers, dashes, and underscores only" value={source}
        onChange={event => setSource(event.target.value)} placeholder="e.g. DEMO-123" />}
      <input className="project-input" value={project} onChange={event => setProject(event.target.value)}
        required={mode === 'text'} maxLength={500}
        placeholder="Project/repository (e.g. acme/api)" aria-label="Project or repository" />
      <button type="submit" className="primary" disabled={pending}>
        {pending ? <LoaderCircle className="spin" size={18} aria-hidden="true" /> : <Play size={17} fill="currentColor" aria-hidden="true" />}
        Start workflow
      </button>
    </div>
    {mode === 'text' && <p className="input-help" id="workflow-source-help">
      This request enters the normal approval workflow. A target repository is required.
    </p>}
    <ErrorMessage message={error} />
  </form>
}
