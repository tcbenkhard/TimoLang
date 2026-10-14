import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { FolderOpen, Trash2 } from 'lucide-react'
import { api } from '../../api'
import { Badge } from '../../components/Badge'
import { ConfirmDialog, type Confirmation } from '../../components/ConfirmDialog'
import { ErrorMessage } from '../../components/ErrorMessage'
import { useAsyncAction } from '../../hooks/useAsyncAction'
import type { GitHubAccount } from '../../types'

export function GitHubAccountsCard() {
  const [accounts, setAccounts] = useState<GitHubAccount[]>([])
  const [account, setAccount] = useState('')
  const [keyPath, setKeyPath] = useState('')
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null)
  const { pending, error, run } = useAsyncAction()

  const loadAccounts = useCallback(async () => setAccounts(await api.githubAccounts()), [])

  useEffect(() => {
    void run(loadAccounts, 'Unable to load GitHub accounts.')
  }, [run, loadAccounts])

  async function save(event: FormEvent) {
    event.preventDefault()
    await run(async () => {
      await api.saveGithubAccount(account.trim(), keyPath.trim())
      setAccount('')
      setKeyPath('')
      await loadAccounts()
    }, 'Unable to save the account.')
  }

  function browse() {
    void run(async () => {
      const { path } = await api.browseSshKey()
      if (path) setKeyPath(path)
    }, 'Unable to open the file browser.')
  }

  function confirmRemoval(name: string) {
    setConfirmation({
      title: `Remove ${name}?`,
      message: 'Relay will no longer use this account. The SSH key file itself is not deleted.',
      confirmLabel: 'Remove account',
      onConfirm: () => void run(async () => {
        await api.deleteGithubAccount(name)
        await loadAccounts()
      }, 'Unable to remove the account.'),
    })
  }

  return <>
    <section className="card settings-card" aria-labelledby="account-form-title" aria-busy={pending}>
      <h2 id="account-form-title">Add or update account</h2>
      <form onSubmit={save} className="settings-form">
        <label>GitHub account
          <input required maxLength={100} pattern="[A-Za-z0-9\-]+" title="Letters, numbers, and dashes only"
            value={account} onChange={event => setAccount(event.target.value)} placeholder="octocat" /></label>
        <label>SSH private key path
          <div className="key-path-input">
            <input required maxLength={2_000} value={keyPath} onChange={event => setKeyPath(event.target.value)}
              placeholder="/Users/me/.ssh/id_ed25519_octocat" />
            <button type="button" disabled={pending} onClick={browse}><FolderOpen size={16} aria-hidden="true" /> Browse</button>
          </div></label>
        <button type="submit" className="primary" disabled={pending}>Save account</button>
      </form>
      <p className="security-note">The chooser starts in your home directory. OpenSSH keys without an extension and .pem, .key, or .priv files are accepted; .pub and .ppk files are excluded. Only the path is stored.</p>
      <ErrorMessage message={error} />
    </section>
    <section className="account-list" aria-label="Configured GitHub accounts">
      {accounts.map(item => <div className="card account-row" key={item.account}>
        <div><strong>{item.account}</strong><code>{item.ssh_key_path}</code></div>
        <div className="account-actions">
          <Badge tone={item.key_available ? 'success' : 'danger'}>{item.key_available ? 'Key found' : 'Key missing'}</Badge>
          <button type="button" disabled={pending} onClick={() => confirmRemoval(item.account)} aria-label={`Remove ${item.account}`}>
            <Trash2 size={16} aria-hidden="true" /></button>
        </div>
      </div>)}
      {accounts.length === 0 && <div className="empty"><p>No GitHub accounts configured.</p></div>}
    </section>
    <ConfirmDialog confirmation={confirmation} onClose={() => setConfirmation(null)} />
  </>
}
