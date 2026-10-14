import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { FolderOpen, Trash2 } from 'lucide-react'
import { api, errorMessage } from '../../api'
import { Badge } from '../../components/Badge'
import { ConfirmDialog, type Confirmation } from '../../components/ConfirmDialog'
import { ErrorMessage } from '../../components/ErrorMessage'
import { useAsyncAction } from '../../hooks/useAsyncAction'
import type { GitHubAccount } from '../../types'

export function GitHubAccountsCard() {
  const [accounts, setAccounts] = useState<GitHubAccount[]>([])
  const [account, setAccount] = useState('')
  const [keyPath, setKeyPath] = useState('')
  const [patToken, setPatToken] = useState('')
  const [githubUsername, setGithubUsername] = useState('')
  const [keyChoices, setKeyChoices] = useState<string[] | null>(null)
  const [loadError, setLoadError] = useState('')
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null)
  const { pending, error, run } = useAsyncAction()

  // The list has its own error state so a failed reload is not reported as a failed save or removal.
  const loadAccounts = useCallback(() => api.githubAccounts().then(
    next => { setAccounts(next); setLoadError('') },
    problem => setLoadError(errorMessage(problem, 'Unable to load GitHub accounts.')),
  ), [])

  useEffect(() => { void loadAccounts() }, [loadAccounts])

  async function save(event: FormEvent) {
    event.preventDefault()
    const saved = await run(async () => {
      await api.saveGithubAccount(account.trim(), keyPath.trim(), patToken, githubUsername.trim())
      setAccount('')
      setKeyPath('')
      setPatToken('')
      setGithubUsername('')
    }, 'Unable to save the account.')
    if (saved) await loadAccounts()
  }

  function browse() {
    void run(async () => {
      const { paths } = await api.browseSshKey()
      setKeyChoices(paths)
    }, 'Unable to open the file browser.')
  }

  async function removeAccount(name: string) {
    const removed = await run(() => api.deleteGithubAccount(name), 'Unable to remove the account.')
    if (removed) await loadAccounts()
  }

  function confirmRemoval(name: string) {
    setConfirmation({
      title: `Remove ${name}?`,
      message: 'Relay will no longer use this account. The SSH key file itself is not deleted.',
      confirmLabel: 'Remove account',
      onConfirm: () => void removeAccount(name),
    })
  }

  return <>
    <section className="card settings-card" aria-labelledby="account-form-title" aria-busy={pending}>
      <h2 id="account-form-title">Add or update account</h2>
      <form onSubmit={save} className="settings-form">
        <label>GitHub account
          <input required maxLength={100} pattern="[A-Za-z0-9\-]+" title="Letters, numbers, and dashes only"
            value={account} onChange={event => setAccount(event.target.value)} placeholder="octocat" /></label>
        <label>GitHub username
          <input required={!!patToken} maxLength={100} pattern="[A-Za-z0-9\-]+" autoComplete="username"
            value={githubUsername} onChange={event => setGithubUsername(event.target.value)} placeholder="Username of the PAT owner" /></label>
        <label>SSH private key path
          <div className="key-path-input">
            <input required={!patToken} maxLength={2_000} value={keyPath} onChange={event => setKeyPath(event.target.value)}
              placeholder="/Users/me/.ssh/id_ed25519_octocat" />
            <button type="button" disabled={pending} onClick={browse}><FolderOpen size={16} aria-hidden="true" /> Browse</button>
          </div></label>
        <label>Personal access token (optional)
          <input type="password" autoComplete="new-password" value={patToken}
            onChange={event => setPatToken(event.target.value)} placeholder="GitHub PAT" /></label>
        <button type="submit" className="primary" disabled={pending}>Save account</button>
      </form>
      <p className="security-note">A PAT uses HTTPS for cloning and pushing and takes priority over SSH. Tokens are stored in the backend database and never displayed again. Saving an account replaces its credentials; leave the token empty and provide a key to switch to SSH.</p>
      {keyChoices !== null && <div className="ssh-key-choices">
        <label htmlFor="ssh-key-choice">Select an SSH private key</label>
        {keyChoices.length > 0 ? <select id="ssh-key-choice" value={keyChoices.includes(keyPath) ? keyPath : ''}
          onChange={event => setKeyPath(event.target.value)}>
          <option value="" disabled>Choose a key…</option>
          {keyChoices.map(path => <option key={path} value={path}>{path}</option>)}
        </select> : <p className="security-note">No supported keys found in the backend’s .ssh directory. Mount your SSH directory with SSH_KEY_DIR when using Docker, or enter an accessible path above.</p>}
      </div>}
      <p className="security-note">Browse lists files in the backend’s .ssh directory. OpenSSH keys without an extension and .pem, .key, or .priv files are accepted; .pub and .ppk files are excluded. Only the path is stored.</p>
      <ErrorMessage message={error} />
    </section>
    <section className="account-list" aria-label="Configured GitHub accounts">
      <ErrorMessage message={loadError} />
      {accounts.map(item => <div className="card account-row" key={item.account}>
        <div><strong>{item.account}</strong><code>{item.pat_configured ? `HTTPS · ${item.username || 'username not configured'} · PAT configured` : item.ssh_key_path}</code></div>
        <div className="account-actions">
          <Badge tone={item.pat_configured || item.key_available ? 'success' : 'danger'}>{item.pat_configured ? 'PAT configured' : item.key_available ? 'Key found' : 'Key missing'}</Badge>
          <button type="button" disabled={pending} onClick={() => confirmRemoval(item.account)} aria-label={`Remove ${item.account}`}>
            <Trash2 size={16} aria-hidden="true" /></button>
        </div>
      </div>)}
      {accounts.length === 0 && !loadError && <div className="empty"><p>No GitHub accounts configured.</p></div>}
    </section>
    <ConfirmDialog confirmation={confirmation} onClose={() => setConfirmation(null)} />
  </>
}
