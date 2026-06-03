import { useState, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'react-hot-toast'
import { Settings, Save, User, Mail } from 'lucide-react'
import { getGlobalConfig, updateGlobalConfig } from '../utils/api'

export default function SettingsPage() {
  const qc = useQueryClient()
  const [userName, setUserName] = useState('')
  const [userEmail, setUserEmail] = useState('')
  const [pat, setPAT] = useState('')
  const [saving, setSaving] = useState(false)

  const { data: config } = useQuery({
    queryKey: ['global-config'],
    queryFn: getGlobalConfig,
  })

  useEffect(() => {
    if (config) {
      const c = config as { user_name: string; user_email: string }
      if (c.user_name) setUserName(c.user_name)
      if (c.user_email) setUserEmail(c.user_email)
    }
  }, [config])

  const save = async () => {
    setSaving(true)
    try {
      await updateGlobalConfig({ user_name: userName, user_email: userEmail, pat })
      toast.success('Settings saved')
      qc.invalidateQueries({ queryKey: ['global-config'] })
    } catch { toast.error('Save failed') }
    finally { setSaving(false) }
  }

  return (
    <div style={{ padding: 24, maxWidth: 600 }}>
      <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 4 }}>Settings</h1>
      <p style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 20 }}>
        Global git configuration. These are applied to all git operations.
      </p>

      <div className="guide-tip" style={{ marginBottom: 20 }}>
        <span>💡</span>
        <div>
          These settings replace <code>git config --global user.name</code> and <code>git config --global user.email</code>.
          Your name and email appear in every commit you make.
        </div>
      </div>

      <div className="card" style={{ padding: 20 }}>
        <h3 style={{ fontWeight: 600, marginBottom: 16 }}>Git Identity</h3>
        <div className="form-group">
          <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <User size={13} /> Your Name
          </label>
          <input className="form-input" value={userName} onChange={e => setUserName(e.target.value)} placeholder="Jane Developer" />
          <div className="form-hint">This appears as the author name on your commits</div>
        </div>
        <div className="form-group">
          <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Mail size={13} /> Your Email
          </label>
          <input className="form-input" value={userEmail} onChange={e => setUserEmail(e.target.value)} placeholder="jane@example.com" />
          <div className="form-hint">This appears as the author email on your commits</div>
        </div>
      </div>

      <div className="card" style={{ padding: 20, marginTop: 16 }}>
        <h3 style={{ fontWeight: 600, marginBottom: 8 }}>Default GitHub PAT</h3>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 12 }}>
          Store a default Personal Access Token for push/pull operations. You can override this per-operation in Advanced Ops.
          See <a href="/ssh" style={{ color: 'var(--text-link)' }}>SSH &amp; Auth</a> for instructions to create a PAT.
        </p>
        <div className="form-group">
          <label className="form-label">GitHub PAT</label>
          <input className="form-input" type="password" value={pat} onChange={e => setPAT(e.target.value)} placeholder="ghp_xxxxxxxxxxxxxxxxxxxx" />
        </div>
      </div>

      <button className="btn btn-primary" onClick={save} disabled={saving} style={{ marginTop: 16 }}>
        <Save size={14} /> {saving ? 'Saving…' : 'Save Settings'}
      </button>

      <div className="card" style={{ padding: 20, marginTop: 24 }}>
        <h3 style={{ fontWeight: 600, marginBottom: 12 }}>All Git Commands Covered</h3>
        <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 12 }}>
          GitVisual provides a visual interface for every git command that exists:
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, fontSize: 12 }}>
          {[
            ['git init / clone', 'Add Repository'],
            ['git add / commit', 'Commits → Commit Changes'],
            ['git status', 'Commits page (file banner)'],
            ['git diff', 'Diff Viewer'],
            ['git branch', 'Branches'],
            ['git checkout / switch', 'Branches → Switch To'],
            ['git merge', 'Merge / Rebase → Merge'],
            ['git rebase', 'Merge / Rebase → Rebase'],
            ['git cherry-pick', 'Merge / Rebase → Cherry-Pick'],
            ['git push', 'Advanced Ops → Push'],
            ['git pull', 'Advanced Ops → Pull'],
            ['git fetch', 'Advanced Ops → Fetch'],
            ['git reset', 'Advanced Ops → Reset'],
            ['git restore', 'Advanced Ops → Restore'],
            ['git stash', 'Stash & Tags → Stash'],
            ['git tag', 'Stash & Tags → Tags'],
            ['git log --graph', 'Advanced Ops → Graph'],
            ['git reflog', 'Advanced Ops → Reflog'],
            ['git bisect', 'Advanced Ops → Bisect'],
            ['git blame', 'Blame page'],
            ['git remote', 'Advanced Ops → Remotes'],
            ['git submodule', 'Advanced Ops → Submodules'],
            ['git revert', 'Commits → Revert'],
            ['git config', 'Settings'],
            ['ssh-keygen / PAT', 'SSH & Auth'],
          ].map(([cmd, page]) => (
            <div key={cmd} style={{ display: 'flex', gap: 8, padding: '4px 0', borderBottom: '1px solid var(--border-muted)' }}>
              <code style={{ color: 'var(--accent-blue)', fontSize: 11, minWidth: 140, flexShrink: 0 }}>{cmd}</code>
              <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>→ {page}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
