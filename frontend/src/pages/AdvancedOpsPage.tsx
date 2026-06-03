import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'react-hot-toast'
import {
  Upload, Download, RefreshCw, RotateCcw, Search, GitBranch,
  Layers, History, Terminal, Plus, InfoIcon, AlertTriangle, Globe
} from 'lucide-react'
import {
  pushRepo, pullRepo, fetchRepo, resetRepo, restoreFile,
  bisect, getReflog, getLogGraph, getRemotes, addRemote,
  getSubmodules, submoduleAction, getBranches, getStatus
} from '../utils/api'
import { Branch, FileStatus, RemoteInfo } from '../types'

export default function AdvancedOpsPage() {
  const { repoId } = useParams<{ repoId: string }>()
  const [tab, setTab] = useState<'sync' | 'reset' | 'bisect' | 'graph' | 'reflog' | 'remotes' | 'submodules'>('sync')

  return (
    <div style={{ padding: 24 }}>
      <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 4 }}>Advanced Git Operations</h1>
      <p style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 20 }}>
        Every advanced git operation — push, pull, fetch, reset, bisect, submodules, reflog — visual and guided.
      </p>

      <div className="tabs" style={{ marginBottom: 24, flexWrap: 'wrap' }}>
        {[
          { id: 'sync', label: '☁️ Push / Pull / Fetch' },
          { id: 'reset', label: '⏪ Reset / Restore' },
          { id: 'bisect', label: '🔍 Bisect' },
          { id: 'graph', label: '📊 Commit Graph' },
          { id: 'reflog', label: '📜 Reflog' },
          { id: 'remotes', label: '🌐 Remotes' },
          { id: 'submodules', label: '📦 Submodules' },
        ].map(t => (
          <button key={t.id} className={`tab ${tab === t.id ? 'active' : ''}`} onClick={() => setTab(t.id as typeof tab)}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'sync' && <SyncPanel repoId={repoId!} />}
      {tab === 'reset' && <ResetPanel repoId={repoId!} />}
      {tab === 'bisect' && <BisectPanel repoId={repoId!} />}
      {tab === 'graph' && <GraphPanel repoId={repoId!} />}
      {tab === 'reflog' && <ReflogPanel repoId={repoId!} />}
      {tab === 'remotes' && <RemotesPanel repoId={repoId!} />}
      {tab === 'submodules' && <SubmodulesPanel repoId={repoId!} />}
    </div>
  )
}

/* ── PUSH / PULL / FETCH ───────────────────────────────────────────────────── */

function SyncPanel({ repoId }: { repoId: string }) {
  const [remote, setRemote] = useState('origin')
  const [branch, setBranch] = useState('')
  const [pat, setPAT] = useState('')
  const [force, setForce] = useState(false)
  const [setUpstream, setSetUpstream] = useState(false)
  const [rebase, setRebase] = useState(false)
  const [prune, setPrune] = useState(false)
  const [fetchAll, setFetchAll] = useState(false)
  const [loading, setLoading] = useState<'push' | 'pull' | 'fetch' | null>(null)
  const [output, setOutput] = useState('')

  const { data: branches = [] } = useQuery<Branch[]>({ queryKey: ['branches', repoId], queryFn: () => getBranches(repoId) })

  const run = async (action: 'push' | 'pull' | 'fetch') => {
    setLoading(action); setOutput('')
    try {
      let result: { message: string }
      if (action === 'push') result = await pushRepo(repoId, { remote, branch, pat, force, set_upstream: setUpstream })
      else if (action === 'pull') result = await pullRepo(repoId, { remote, branch, rebase })
      else result = await fetchRepo(repoId, { remote, prune, all: fetchAll })
      setOutput(result.message || 'Done')
      toast.success(`${action} successful!`)
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string; has_conflicts?: boolean } } }
      const msg = err?.response?.data?.error || 'Operation failed'
      setOutput(msg)
      if (err?.response?.data?.has_conflicts) toast.error('Conflicts! Go to Conflict Resolver.')
      else toast.error(msg)
    } finally { setLoading(null) }
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr', gap: 20, maxWidth: 900 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* Settings card */}
        <div className="card" style={{ padding: 16 }}>
          <h3 style={{ fontWeight: 600, fontSize: 14, marginBottom: 14 }}>Settings</h3>
          <div className="form-group">
            <label className="form-label">Remote</label>
            <input className="form-input" value={remote} onChange={e => setRemote(e.target.value)} placeholder="origin" />
          </div>
          <div className="form-group">
            <label className="form-label">Branch (blank = current)</label>
            <select className="form-input" value={branch} onChange={e => setBranch(e.target.value)}>
              <option value="">Current branch</option>
              {(branches as Branch[]).map((b: Branch) => <option key={b.id} value={b.name}>{b.name}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <span>🔑</span> PAT (for HTTPS auth)
            </label>
            <input className="form-input" type="password" value={pat} onChange={e => setPAT(e.target.value)} placeholder="ghp_…" />
            <div className="form-hint">
              <a href="https://github.com/settings/tokens/new?scopes=repo" target="_blank" rel="noreferrer">Create GitHub PAT ↗</a>
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
              <input type="checkbox" checked={force} onChange={e => setForce(e.target.checked)} />
              Force push (--force-with-lease)
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
              <input type="checkbox" checked={setUpstream} onChange={e => setSetUpstream(e.target.checked)} />
              Set upstream (-u)
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
              <input type="checkbox" checked={rebase} onChange={e => setRebase(e.target.checked)} />
              Pull with rebase
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
              <input type="checkbox" checked={prune} onChange={e => setPrune(e.target.checked)} />
              Prune deleted remote branches
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
              <input type="checkbox" checked={fetchAll} onChange={e => setFetchAll(e.target.checked)} />
              Fetch all remotes
            </label>
          </div>
        </div>

        {/* Action buttons */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div className="guide-tip">
            <Upload size={14} style={{ flexShrink: 0 }} />
            <div>
              <strong>Push</strong> uploads your local commits to the remote.
              Use <em>force-with-lease</em> instead of plain force — it's safer.
            </div>
          </div>
          <button className="btn btn-primary" onClick={() => run('push')} disabled={!!loading} style={{ justifyContent: 'center' }}>
            {loading === 'push' ? <><div className="spinner" style={{ width: 14, height: 14 }} /> Pushing…</> : <><Upload size={14} /> Push</>}
          </button>

          <div className="guide-tip">
            <Download size={14} style={{ flexShrink: 0 }} />
            <div><strong>Pull</strong> downloads remote changes and merges them into your current branch.</div>
          </div>
          <button className="btn btn-success" onClick={() => run('pull')} disabled={!!loading} style={{ justifyContent: 'center' }}>
            {loading === 'pull' ? <><div className="spinner" style={{ width: 14, height: 14 }} /> Pulling…</> : <><Download size={14} /> Pull</>}
          </button>

          <div className="guide-tip">
            <RefreshCw size={14} style={{ flexShrink: 0 }} />
            <div><strong>Fetch</strong> downloads remote changes without merging — lets you inspect before applying.</div>
          </div>
          <button className="btn btn-ghost" onClick={() => run('fetch')} disabled={!!loading} style={{ justifyContent: 'center', border: '1px solid var(--border)' }}>
            {loading === 'fetch' ? <><div className="spinner" style={{ width: 14, height: 14 }} /> Fetching…</> : <><RefreshCw size={14} /> Fetch</>}
          </button>
        </div>
      </div>

      {/* Output */}
      <div className="card" style={{ padding: 0 }}>
        <div className="card-header">
          <span style={{ fontWeight: 600 }}>Output</span>
        </div>
        <pre style={{ padding: 16, fontFamily: 'var(--font-mono)', fontSize: 12, color: output.toLowerCase().includes('error') || output.toLowerCase().includes('fail') ? 'var(--accent-red-hover)' : 'var(--diff-add-text)', minHeight: 200, whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: 0 }}>
          {output || '— Run an operation to see output —'}
        </pre>
      </div>
    </div>
  )
}

/* ── RESET / RESTORE ───────────────────────────────────────────────────────── */

function ResetPanel({ repoId }: { repoId: string }) {
  const [mode, setMode] = useState('mixed')
  const [ref, setRef] = useState('HEAD~1')
  const [restorePath, setRestorePath] = useState('')
  const [staged, setStaged] = useState(false)
  const [loading, setLoading] = useState(false)

  const { data: statusFiles = [] } = useQuery<FileStatus[]>({ queryKey: ['status', repoId], queryFn: () => getStatus(repoId) })

  const handleReset = async () => {
    if (!confirm(`Reset to "${ref}" with --${mode}? ${mode === 'hard' ? '⚠️ HARD reset will discard all changes!' : ''}`)) return
    setLoading(true)
    try {
      const result = await resetRepo(repoId, { mode, ref })
      toast.success(`Reset to ${ref} (--${mode})`)
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } } }
      toast.error(err?.response?.data?.error || 'Reset failed')
    } finally { setLoading(false) }
  }

  const handleRestore = async () => {
    if (!restorePath) { toast.error('Select or enter a file path'); return }
    try {
      await restoreFile(repoId, { path: restorePath, staged })
      toast.success(`Restored ${restorePath}`)
    } catch { toast.error('Restore failed') }
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, maxWidth: 800 }}>
      {/* Reset */}
      <div className="card" style={{ padding: 20 }}>
        <h3 style={{ fontWeight: 600, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
          <RotateCcw size={16} /> Reset HEAD
        </h3>
        <div className="guide-tip" style={{ marginBottom: 14 }}>
          <AlertTriangle size={14} style={{ flexShrink: 0 }} />
          <div style={{ fontSize: 12 }}>
            <strong>Soft</strong> — keep changes staged · <strong>Mixed</strong> — keep changes unstaged · <strong>Hard</strong> — discard all changes
          </div>
        </div>
        <div className="form-group">
          <label className="form-label">Mode</label>
          <select className="form-input" value={mode} onChange={e => setMode(e.target.value)}>
            <option value="soft">Soft (keep staged)</option>
            <option value="mixed">Mixed (unstage, keep files)</option>
            <option value="hard">Hard (discard everything)</option>
          </select>
        </div>
        <div className="form-group">
          <label className="form-label">Target Ref</label>
          <input className="form-input" value={ref} onChange={e => setRef(e.target.value)} placeholder="HEAD~1, abc1234, main…" />
          <div className="form-hint">HEAD~1 = one commit back, HEAD~3 = three commits back</div>
        </div>
        {mode === 'hard' && (
          <div className="banner banner-error" style={{ marginBottom: 12 }}>
            <AlertTriangle size={14} />
            <span>Hard reset permanently discards uncommitted changes. This cannot be undone (unless you use reflog).</span>
          </div>
        )}
        <button className={`btn ${mode === 'hard' ? 'btn-danger' : 'btn-primary'}`} onClick={handleReset} disabled={loading}>
          {loading ? 'Resetting…' : `⏪ Reset --${mode}`}
        </button>
      </div>

      {/* Restore */}
      <div className="card" style={{ padding: 20 }}>
        <h3 style={{ fontWeight: 600, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
          <RotateCcw size={16} /> Restore File
        </h3>
        <div className="guide-tip" style={{ marginBottom: 14 }}>
          <InfoIcon size={14} style={{ flexShrink: 0 }} />
          <div style={{ fontSize: 12 }}>
            <strong>Restore</strong> discards changes to a specific file. Like <code>git checkout -- file</code> but safer.
          </div>
        </div>
        <div className="form-group">
          <label className="form-label">File Path</label>
          {(statusFiles as FileStatus[]).length > 0 ? (
            <select className="form-input" value={restorePath} onChange={e => setRestorePath(e.target.value)}>
              <option value="">Select a changed file…</option>
              {(statusFiles as FileStatus[]).map((f: FileStatus) => <option key={f.path} value={f.path}>{f.path}</option>)}
            </select>
          ) : (
            <input className="form-input" value={restorePath} onChange={e => setRestorePath(e.target.value)} placeholder="src/components/MyFile.tsx" />
          )}
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer', marginBottom: 14 }}>
          <input type="checkbox" checked={staged} onChange={e => setStaged(e.target.checked)} />
          Unstage only (keep working tree changes)
        </label>
        <button className="btn btn-danger" onClick={handleRestore} disabled={!restorePath}>
          🔄 Restore File
        </button>
      </div>
    </div>
  )
}

/* ── BISECT ────────────────────────────────────────────────────────────────── */

function BisectPanel({ repoId }: { repoId: string }) {
  const [good, setGood] = useState('')
  const [bad, setBad] = useState('HEAD')
  const [output, setOutput] = useState('')
  const [active, setActive] = useState(false)
  const [loading, setLoading] = useState(false)

  const run = async (action: string) => {
    setLoading(true)
    try {
      const result = await bisect(repoId, { action, good, bad })
      setOutput(result.output || '')
      if (action === 'start') { setActive(true); toast.success('Bisect started!') }
      if (action === 'reset') { setActive(false); toast.success('Bisect ended') }
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } } }
      setOutput(err?.response?.data?.error || 'Failed')
    } finally { setLoading(false) }
  }

  return (
    <div style={{ maxWidth: 800 }}>
      <div className="guide-tip" style={{ marginBottom: 16 }}>
        <Search size={15} style={{ flexShrink: 0, color: 'var(--text-link)' }} />
        <div>
          <strong>Bisect</strong> uses binary search to find which commit introduced a bug.
          <ol style={{ marginTop: 6, marginLeft: 16, fontSize: 12, lineHeight: 1.8 }}>
            <li>Enter a <strong>known good</strong> commit (before the bug) and <strong>known bad</strong> commit (after the bug)</li>
            <li>Click Start — git checks out the middle commit</li>
            <li>Test your code, then mark it Good or Bad</li>
            <li>Repeat until git finds the exact bad commit</li>
          </ol>
        </div>
      </div>

      <div className="card" style={{ padding: 20, marginBottom: 16, maxWidth: 500 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
          <div className="form-group" style={{ margin: 0 }}>
            <label className="form-label" style={{ color: 'var(--diff-add-text)' }}>✅ Known Good Commit</label>
            <input className="form-input" value={good} onChange={e => setGood(e.target.value)} placeholder="abc1234 (before bug)" />
          </div>
          <div className="form-group" style={{ margin: 0 }}>
            <label className="form-label" style={{ color: 'var(--accent-red-hover)' }}>❌ Known Bad Commit</label>
            <input className="form-input" value={bad} onChange={e => setBad(e.target.value)} placeholder="HEAD (has bug)" />
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn btn-primary" onClick={() => run('start')} disabled={loading || !good}>
            🔍 Start Bisect
          </button>
          {active && (
            <>
              <button className="btn btn-success" onClick={() => run('good')} disabled={loading}>✅ Mark Good</button>
              <button className="btn btn-danger" onClick={() => run('bad')} disabled={loading}>❌ Mark Bad</button>
              <button className="btn btn-ghost" onClick={() => run('skip')} disabled={loading}>⏭ Skip</button>
              <button className="btn btn-ghost" onClick={() => run('reset')} disabled={loading}>⛔ End Bisect</button>
            </>
          )}
        </div>
      </div>

      {output && (
        <div className="card">
          <div className="card-header"><span style={{ fontWeight: 600 }}>Bisect Output</span></div>
          <pre style={{ padding: 14, fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-secondary)', whiteSpace: 'pre-wrap', margin: 0 }}>
            {output}
          </pre>
        </div>
      )}
    </div>
  )
}

/* ── COMMIT GRAPH ──────────────────────────────────────────────────────────── */

function GraphPanel({ repoId }: { repoId: string }) {
  const [limit, setLimit] = useState(50)
  const { data, isLoading, refetch } = useQuery<{ graph: string }>({
    queryKey: ['graph', repoId, limit],
    queryFn: () => getLogGraph(repoId, limit),
  })

  const lines = (data?.graph || '').split('\n')

  return (
    <div style={{ maxWidth: 900 }}>
      <div className="guide-tip" style={{ marginBottom: 16 }}>
        <span>📊</span>
        <div>
          <strong>Commit Graph</strong> shows your full branch history visually. Branches, merges, and tags are color-coded.
          This is equivalent to <code>git log --graph --all --oneline --decorate</code>.
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <label style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Show last</label>
        <select value={limit} onChange={e => setLimit(Number(e.target.value))} style={{ width: 80 }}>
          <option value={25}>25</option>
          <option value={50}>50</option>
          <option value={100}>100</option>
          <option value={200}>200</option>
        </select>
        <label style={{ fontSize: 13, color: 'var(--text-secondary)' }}>commits</label>
        <button className="btn btn-ghost btn-sm" onClick={() => refetch()}><RefreshCw size={13} /> Refresh</button>
      </div>
      {isLoading ? (
        <div className="loading"><div className="spinner" /></div>
      ) : (
        <div className="card" style={{ overflow: 'auto', maxHeight: 500 }}>
          {lines.map((line, i) => (
            <div key={i} className="graph-line" style={{
              color: line.includes('HEAD') ? 'var(--accent-blue)' :
                line.includes('origin') ? 'var(--accent-orange)' :
                line.includes('tag:') ? 'var(--accent-yellow)' :
                'var(--text-secondary)'
            }}>
              {line || ' '}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/* ── REFLOG ────────────────────────────────────────────────────────────────── */

function ReflogPanel({ repoId }: { repoId: string }) {
  const { data: reflog = [], isLoading } = useQuery<string[]>({
    queryKey: ['reflog', repoId],
    queryFn: () => getReflog(repoId),
  })

  return (
    <div style={{ maxWidth: 800 }}>
      <div className="guide-tip" style={{ marginBottom: 16 }}>
        <History size={15} style={{ flexShrink: 0, color: 'var(--text-link)' }} />
        <div>
          <strong>Reflog</strong> is git's safety net — it records every HEAD movement. Even after a hard reset or accidental delete,
          you can find the commit hash here and recover your work with Reset → that hash.
        </div>
      </div>
      {isLoading ? (
        <div className="loading"><div className="spinner" /></div>
      ) : (reflog as string[]).length === 0 ? (
        <div className="empty-state"><History size={40} /><p>No reflog entries</p></div>
      ) : (
        <div className="card" style={{ overflow: 'auto', maxHeight: 500 }}>
          {(reflog as string[]).map((line: string, i: number) => {
            const parts = line.split(' ')
            const hash = parts[0]
            const rest = parts.slice(1).join(' ')
            return (
              <div key={i} style={{ display: 'flex', gap: 12, padding: '7px 14px', borderBottom: '1px solid var(--border-muted)', fontFamily: 'var(--font-mono)', fontSize: 12 }}>
                <code style={{ color: 'var(--accent-blue)', minWidth: 70, flexShrink: 0 }}>{hash}</code>
                <span style={{ color: 'var(--text-secondary)', flex: 1 }}>{rest}</span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

/* ── REMOTES ───────────────────────────────────────────────────────────────── */

function RemotesPanel({ repoId }: { repoId: string }) {
  const qc = useQueryClient()
  const [name, setName] = useState('origin')
  const [url, setUrl] = useState('')
  const [adding, setAdding] = useState(false)

  const { data: remotes = [], isLoading } = useQuery<RemoteInfo[]>({
    queryKey: ['remotes', repoId],
    queryFn: () => getRemotes(repoId),
  })

  const handleAdd = async () => {
    if (!name || !url) { toast.error('Name and URL required'); return }
    try {
      await addRemote(repoId, { name, url })
      toast.success(`Remote "${name}" added`)
      setAdding(false); setName('origin'); setUrl('')
      qc.invalidateQueries({ queryKey: ['remotes', repoId] })
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } } }
      toast.error(err?.response?.data?.error || 'Failed to add remote')
    }
  }

  return (
    <div style={{ maxWidth: 700 }}>
      <div className="guide-tip" style={{ marginBottom: 16 }}>
        <Globe size={15} style={{ flexShrink: 0, color: 'var(--text-link)' }} />
        <div>
          <strong>Remotes</strong> are references to other repositories (e.g., GitHub).
          <code>origin</code> is the default remote for a cloned repo.
          You can have multiple remotes (e.g., upstream + fork).
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
        <button className="btn btn-primary btn-sm" onClick={() => setAdding(a => !a)}>
          <Plus size={13} /> Add Remote
        </button>
      </div>

      {adding && (
        <div className="card" style={{ padding: 16, marginBottom: 14 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: 10, marginBottom: 10 }}>
            <div>
              <label className="form-label">Name</label>
              <input className="form-input" value={name} onChange={e => setName(e.target.value)} placeholder="origin" />
            </div>
            <div>
              <label className="form-label">URL</label>
              <input className="form-input" value={url} onChange={e => setUrl(e.target.value)} placeholder="https://github.com/user/repo.git" />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-primary btn-sm" onClick={handleAdd}>Add</button>
            <button className="btn btn-ghost btn-sm" onClick={() => setAdding(false)}>Cancel</button>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="loading"><div className="spinner" /></div>
      ) : (remotes as RemoteInfo[]).length === 0 ? (
        <div className="empty-state">
          <Globe size={40} />
          <p>No remotes configured</p>
          <p style={{ fontSize: 13 }}>Add a remote to push/pull from GitHub, GitLab, etc.</p>
        </div>
      ) : (
        <div className="card">
          {(remotes as RemoteInfo[]).map((r: RemoteInfo, i: number) => (
            <div key={i} style={{ padding: '12px 16px', borderBottom: i < (remotes as RemoteInfo[]).length - 1 ? '1px solid var(--border-muted)' : 'none', display: 'flex', alignItems: 'center', gap: 12 }}>
              <Globe size={16} color="var(--accent-blue)" />
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: 13, fontFamily: 'var(--font-mono)' }}>{r.name}</div>
                <a href={r.url.replace(/\.git$/, '')} target="_blank" rel="noreferrer"
                  style={{ fontSize: 12, color: 'var(--text-link)' }}>{r.url}</a>
              </div>
              {r.url.includes('github.com') && (
                <a href={r.url.replace(/\.git$/, '').replace('https://', 'https://')} target="_blank" rel="noreferrer"
                  className="btn btn-ghost btn-sm">View on GitHub ↗</a>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/* ── SUBMODULES ────────────────────────────────────────────────────────────── */

function SubmodulesPanel({ repoId }: { repoId: string }) {
  const qc = useQueryClient()
  const [action, setAction] = useState<'add' | 'update' | 'init'>('update')
  const [subUrl, setSubUrl] = useState('')
  const [subPath, setSubPath] = useState('')
  const [loading, setLoading] = useState(false)

  const { data: submodules = [], isLoading } = useQuery<string[]>({
    queryKey: ['submodules', repoId],
    queryFn: () => getSubmodules(repoId),
  })

  const handleAction = async () => {
    setLoading(true)
    try {
      await submoduleAction(repoId, { action, url: subUrl, path: subPath })
      toast.success(`Submodule ${action} complete`)
      qc.invalidateQueries({ queryKey: ['submodules', repoId] })
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } } }
      toast.error(err?.response?.data?.error || `Submodule ${action} failed`)
    } finally { setLoading(false) }
  }

  return (
    <div style={{ maxWidth: 700 }}>
      <div className="guide-tip" style={{ marginBottom: 16 }}>
        <Layers size={15} style={{ flexShrink: 0, color: 'var(--text-link)' }} />
        <div>
          <strong>Submodules</strong> embed another git repository inside yours.
          Common for shared libraries or dependencies that are also under git.
          <ul style={{ marginTop: 6, marginLeft: 16, fontSize: 12 }}>
            <li><strong>Init</strong> — register submodules from .gitmodules</li>
            <li><strong>Update</strong> — fetch and checkout all submodules</li>
            <li><strong>Add</strong> — add a new submodule from a URL</li>
          </ul>
        </div>
      </div>

      <div className="card" style={{ padding: 16, marginBottom: 16, maxWidth: 500 }}>
        <div className="form-group">
          <label className="form-label">Action</label>
          <select className="form-input" value={action} onChange={e => setAction(e.target.value as typeof action)}>
            <option value="init">Init (register from .gitmodules)</option>
            <option value="update">Update (fetch all submodules)</option>
            <option value="add">Add new submodule</option>
          </select>
        </div>
        {action === 'add' && (
          <>
            <div className="form-group">
              <label className="form-label">Repository URL</label>
              <input className="form-input" value={subUrl} onChange={e => setSubUrl(e.target.value)} placeholder="https://github.com/user/library.git" />
            </div>
            <div className="form-group">
              <label className="form-label">Local Path</label>
              <input className="form-input" value={subPath} onChange={e => setSubPath(e.target.value)} placeholder="libs/library" />
            </div>
          </>
        )}
        <button className="btn btn-primary" onClick={handleAction} disabled={loading}>
          {loading ? 'Running…' : `📦 ${action.charAt(0).toUpperCase() + action.slice(1)} Submodule(s)`}
        </button>
      </div>

      {isLoading ? (
        <div className="loading"><div className="spinner" /></div>
      ) : (submodules as string[]).length === 0 ? (
        <div className="empty-state"><Layers size={40} /><p>No submodules</p></div>
      ) : (
        <div className="card">
          <div className="card-header"><span style={{ fontWeight: 600 }}>Submodules</span></div>
          {(submodules as string[]).map((s: string, i: number) => (
            <div key={i} style={{ padding: '8px 14px', borderBottom: '1px solid var(--border-muted)', fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-secondary)' }}>
              {s}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}



