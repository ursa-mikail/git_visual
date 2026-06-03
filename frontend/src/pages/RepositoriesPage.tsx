import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { toast } from 'react-hot-toast'
import {
  GitFork, Plus, Trash2, Edit2, Search, X, Key, Globe,
  RefreshCw, AlertCircle, CheckCircle, Clock, Info, Scan, FolderSearch,
} from 'lucide-react'
import { getRepos, createRepo, deleteRepo, updateRepo, syncRepo, discoverRepos, bulkImportRepos } from '../utils/api'
import { Repository } from '../types'

interface Discovered { name: string; path: string; remote_url: string; branch: string }

export default function RepositoriesPage() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const [showAdd, setShowAdd] = useState(false)
  const [showDiscover, setShowDiscover] = useState(false)
  const [editing, setEditing] = useState<Repository | null>(null)
  const [syncing, setSyncing] = useState<string | null>(null)

  const { data: repos = [], isLoading } = useQuery<Repository[]>({
    queryKey: ['repos', search],
    queryFn: () => getRepos(search),
    refetchInterval: 4000,
  })

  const handleDelete = async (repo: Repository) => {
    if (!confirm(`Remove "${repo.name}" from GitVisual? (files on disk are NOT deleted)`)) return
    await deleteRepo(repo.id)
    qc.invalidateQueries({ queryKey: ['repos'] })
    toast.success('Repository removed')
  }

  const handleSync = async (repo: Repository) => {
    setSyncing(repo.id)
    try {
      await syncRepo(repo.id)
      qc.invalidateQueries({ queryKey: ['repos'] })
      toast.success(`Synced ${repo.name}`)
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } } }
      toast.error(err?.response?.data?.error || 'Sync failed')
    } finally { setSyncing(null) }
  }

  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 700 }}>Repositories</h1>
          <p style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 2 }}>
            Discover local repos automatically, or clone/register manually.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-ghost" onClick={() => setShowDiscover(true)}>
            <FolderSearch size={15} /> Discover Local Repos
          </button>
          <button className="btn btn-primary" onClick={() => setShowAdd(true)}>
            <Plus size={15} /> Add / Clone
          </button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
        <div style={{ position: 'relative', flex: 1, maxWidth: 400 }}>
          <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }} />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search repositories…" style={{ width: '100%', paddingLeft: 32 }} />
        </div>
      </div>

      {isLoading ? (
        <div className="loading"><div className="spinner" /> Loading…</div>
      ) : (repos as Repository[]).length === 0 ? (
        <div className="empty-state">
          <GitFork size={48} />
          <div>
            <p style={{ fontWeight: 600, marginBottom: 8 }}>No repositories yet</p>
            <button className="btn btn-primary" onClick={() => setShowDiscover(true)}>
              <FolderSearch size={15} /> Discover repos on your Mac
            </button>
          </div>
          <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            Or click "Add / Clone" to enter a URL or path manually.
          </p>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 12 }}>
          {(repos as Repository[]).map((repo: Repository) => {
            const cloneFailed = repo.description?.startsWith('Clone failed:')
            const cloneInProgress = !repo.is_initialized && repo.remote_url && !cloneFailed
            return (
              <div key={repo.id} className="card"
                style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '14px 16px', cursor: repo.is_initialized ? 'pointer' : 'default' }}
                onClick={() => repo.is_initialized && navigate(`/repos/${repo.id}`)}>
                <div style={{ width: 40, height: 40, borderRadius: 8, background: 'linear-gradient(135deg, var(--accent-blue)33, var(--accent-purple)33)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--accent-blue)', flexShrink: 0 }}>
                  {cloneInProgress ? <div className="spinner" style={{ width: 18, height: 18 }} /> :
                   cloneFailed ? <AlertCircle size={18} color="var(--accent-red)" /> :
                   <GitFork size={18} />}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                    <span style={{ fontWeight: 600, fontSize: 14 }}>{repo.name}</span>
                    {cloneInProgress && <span className="badge badge-yellow"><Clock size={10} /> Cloning…</span>}
                    {cloneFailed && <span className="badge" style={{ background: 'var(--accent-red)22', color: 'var(--accent-red)' }}>Clone Failed</span>}
                    {repo.is_initialized && <span className="badge badge-green"><CheckCircle size={10} /> Ready</span>}
                    {!repo.is_initialized && !cloneInProgress && !cloneFailed &&
                      <span className="badge badge-gray">Not initialized</span>}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                    <span>📁 {repo.path}</span>
                    {repo.default_branch && <span>🌿 {repo.default_branch}</span>}
                    {cloneFailed && <span style={{ color: 'var(--accent-red)' }}>{repo.description}</span>}
                    {!cloneFailed && repo.description && <span>· {repo.description}</span>}
                  </div>
                </div>
                {repo.github_url && (
                  <a href={repo.github_url} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()} className="btn btn-ghost btn-sm">
                    <Globe size={13} /> GitHub ↗
                  </a>
                )}
                <div style={{ display: 'flex', gap: 6 }} onClick={e => e.stopPropagation()}>
                  {!repo.is_initialized && !cloneInProgress && (
                    <button className="btn btn-ghost btn-sm" onClick={() => handleSync(repo)} disabled={syncing === repo.id} title="Sync / mark ready">
                      <RefreshCw size={13} className={syncing === repo.id ? 'spin' : ''} /> Sync
                    </button>
                  )}
                  {repo.is_initialized && (
                    <button className="btn btn-ghost btn-icon" onClick={() => handleSync(repo)} disabled={syncing === repo.id} title="Sync from git">
                      <RefreshCw size={13} className={syncing === repo.id ? 'spin' : ''} />
                    </button>
                  )}
                  <button className="btn btn-ghost btn-icon" onClick={() => setEditing(repo)} title="Edit"><Edit2 size={14} /></button>
                  <button className="btn btn-ghost btn-icon" onClick={() => handleDelete(repo)} title="Remove" style={{ color: 'var(--accent-red-hover)' }}><Trash2 size={14} /></button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {showDiscover && (
        <DiscoverModal onClose={() => setShowDiscover(false)} onDone={() => {
          setShowDiscover(false)
          qc.invalidateQueries({ queryKey: ['repos'] })
        }} />
      )}
      {showAdd && <AddRepoModal onClose={() => setShowAdd(false)} onDone={(repoId) => {
        setShowAdd(false)
        qc.invalidateQueries({ queryKey: ['repos'] })
        if (repoId) navigate(`/repos/${repoId}`)
      }} />}
      {editing && <EditRepoModal repo={editing} onClose={() => setEditing(null)} onDone={() => { setEditing(null); qc.invalidateQueries({ queryKey: ['repos'] }) }} />}
    </div>
  )
}

// ── Discover Modal ────────────────────────────────────────────────────────────
function DiscoverModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [importing, setImporting] = useState(false)

  const { data: found = [], isLoading, error } = useQuery<Discovered[]>({
    queryKey: ['discover'],
    queryFn: () => discoverRepos(),
    staleTime: 0,
  })

  const repos = found as Discovered[]

  const toggle = (path: string) =>
    setSelected(s => { const n = new Set(s); n.has(path) ? n.delete(path) : n.add(path); return n })
  const toggleAll = () =>
    setSelected(selected.size === repos.length ? new Set() : new Set(repos.map(r => r.path)))

  const importSelected = async () => {
    const toImport = repos.filter(r => selected.has(r.path))
    if (!toImport.length) return
    setImporting(true)
    try {
      const result = await bulkImportRepos(toImport) as { imported: number }
      toast.success(`Imported ${result.imported} repositor${result.imported === 1 ? 'y' : 'ies'}`)
      onDone()
    } catch {
      toast.error('Import failed')
    } finally { setImporting(false) }
  }

  return (
    <div className="modal-overlay">
      <div className="modal modal-lg">
        <div className="modal-header">
          <h3 style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}>
            <FolderSearch size={16} /> Discover Local Repositories
          </h3>
          <button className="btn btn-ghost btn-icon" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="modal-body">
          <div className="guide-tip" style={{ marginBottom: 16 }}>
            <Scan size={15} style={{ flexShrink: 0 }} />
            <div>
              Scanning your home directory (mounted at <code style={{ background: 'var(--bg-overlay)', padding: '1px 5px', borderRadius: 3 }}>/host-home</code>) for git repositories.
              Select the ones you want to import — already-registered repos are hidden.
            </div>
          </div>

          {isLoading ? (
            <div className="loading"><div className="spinner" /> Scanning for git repos…</div>
          ) : error ? (
            <div className="empty-state" style={{ color: 'var(--accent-red-hover)' }}>
              <AlertCircle size={32} />
              <p>Scan failed — make sure the container has access to /host-home</p>
            </div>
          ) : repos.length === 0 ? (
            <div className="empty-state">
              <GitFork size={40} />
              <p>No unregistered git repos found in your home directory.</p>
            </div>
          ) : (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>{repos.length} repo{repos.length !== 1 ? 's' : ''} found</span>
                <button className="btn btn-ghost btn-sm" onClick={toggleAll}>
                  {selected.size === repos.length ? 'Deselect all' : 'Select all'}
                </button>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 400, overflowY: 'auto' }}>
                {repos.map(r => (
                  <label key={r.path} style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '10px 12px', borderRadius: 8, border: `1px solid ${selected.has(r.path) ? 'var(--accent-blue)' : 'var(--border)'}`, background: selected.has(r.path) ? 'var(--accent-blue)0a' : 'var(--bg-elevated)', cursor: 'pointer' }}>
                    <input type="checkbox" checked={selected.has(r.path)} onChange={() => toggle(r.path)} style={{ marginTop: 2, flexShrink: 0 }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 2 }}>{r.name}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{r.path}</div>
                      {r.remote_url && (
                        <div style={{ fontSize: 11, color: 'var(--text-link)', marginTop: 2 }}>🔗 {r.remote_url}</div>
                      )}
                      {r.branch && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 1 }}>🌿 {r.branch}</div>}
                    </div>
                  </label>
                ))}
              </div>
            </>
          )}
        </div>
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={importSelected}
            disabled={importing || selected.size === 0 || isLoading}>
            {importing
              ? <><div className="spinner" style={{ width: 14, height: 14 }} /> Importing…</>
              : `Import ${selected.size > 0 ? selected.size : ''} selected`}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Add Repo Modal ────────────────────────────────────────────────────────────
function AddRepoModal({ onClose, onDone }: { onClose: () => void; onDone: (repoId?: string) => void }) {
  const [tab, setTab] = useState<'clone' | 'local' | 'new'>('clone')
  const [name, setName] = useState('')
  const [rawPath, setRawPath] = useState('')
  const [remoteURL, setRemoteURL] = useState('')
  const [pat, setPAT] = useState('')
  const [desc, setDesc] = useState('')
  const [loading, setLoading] = useState(false)
  const [urlError, setUrlError] = useState('')

  const translatePath = (p: string) => {
    if (!p || p.startsWith('/host-home/') || p.startsWith('/repos/')) return p
    for (const prefix of ['/Users/', '/home/']) {
      if (p.startsWith(prefix)) {
        const rest = p.slice(prefix.length)
        const slash = rest.indexOf('/')
        return slash >= 0 ? '/host-home' + rest.slice(slash) : '/host-home'
      }
    }
    return p
  }

  const normalizeURL = (url: string) => {
    const t = url.trim()
    if (!t || t.startsWith('http') || t.startsWith('git@') || t.startsWith('ssh://')) return t
    if (/^(github\.com|gitlab\.com|bitbucket\.org)\//.test(t)) return 'https://' + t
    return t
  }

  const handleURLChange = (url: string) => {
    setRemoteURL(url)
    setUrlError('')
    if (url && !name) {
      const parts = url.replace(/\.git$/, '').split('/')
      const last = parts[parts.length - 1]
      if (last) setName(last)
    }
  }

  const submit = async () => {
    if (!name) { toast.error('Repository name is required'); return }
    if (tab === 'clone' && !remoteURL) { toast.error('URL is required'); return }
    if (tab === 'local' && !rawPath) { toast.error('Path is required'); return }

    const effectiveURL = tab === 'clone' ? normalizeURL(remoteURL) : null
    const effectivePath = tab === 'local' ? rawPath : `/repos/${name}`

    setLoading(true)
    try {
      const repo = await createRepo({
        name, path: effectivePath,
        remote_url: effectiveURL,
        github_url: effectiveURL?.includes('github.com') ? effectiveURL : null,
        description: desc || null,
        pat: tab === 'clone' ? pat : '',
        mode: tab,
      } as any)

      if (tab === 'clone') {
        toast.success(`Cloning "${name}" in background — card updates when done.`, { duration: 6000 })
      } else {
        toast.success(`"${name}" added!`)
      }
      onDone(repo?.id)
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } }; message?: string }
      toast.error(err?.response?.data?.error || err?.message || 'Failed', { duration: 8000 })
    } finally { setLoading(false) }
  }

  const translatedPath = translatePath(rawPath)
  const showTranslation = tab === 'local' && rawPath && translatedPath !== rawPath

  return (
    <div className="modal-overlay">
      <div className="modal modal-lg">
        <div className="modal-header">
          <h3 style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}><GitFork size={16} /> Add Repository</h3>
          <button className="btn btn-ghost btn-icon" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="modal-body">
          <div className="tabs" style={{ marginBottom: 20 }}>
            {(['clone', 'local', 'new'] as const).map(t => (
              <button key={t} className={`tab ${tab === t ? 'active' : ''}`} onClick={() => { setTab(t); setUrlError('') }}>
                {t === 'clone' ? '📥 Clone from URL' : t === 'local' ? '📁 Add Local Path' : '🆕 New Empty Repo'}
              </button>
            ))}
          </div>

          {tab === 'clone' && (
            <>
              <div className="guide-tip" style={{ marginBottom: 16 }}>
                <Info size={15} style={{ flexShrink: 0 }} />
                <div>
                  Public repos clone without a token. SSH keys mounted at <code style={{ background: 'var(--bg-overlay)', padding: '1px 4px', borderRadius: 3 }}>/root/.ssh</code> are used automatically.
                  For private repos needing HTTPS, add a PAT below.
                </div>
              </div>
              <div className="form-group">
                <label className="form-label">Repository URL *</label>
                <input className="form-input" value={remoteURL}
                  onChange={e => handleURLChange(e.target.value)}
                  onBlur={() => { if (remoteURL) { const n = normalizeURL(remoteURL); if (!n.startsWith('http') && !n.startsWith('git@')) setUrlError('URL must start with https:// or git@') } }}
                  placeholder="https://github.com/ursa-mikail/templates  or  git@github.com:user/repo"
                  style={{ borderColor: urlError ? 'var(--accent-red)' : undefined }} />
                {urlError
                  ? <div className="form-hint" style={{ color: 'var(--accent-red)' }}>⚠ {urlError}</div>
                  : <div className="form-hint">HTTPS or SSH — your SSH keys are already available in the container</div>}
              </div>
              <div className="form-group">
                <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Key size={13} /> Personal Access Token — private HTTPS repos only
                </label>
                <input className="form-input" value={pat} onChange={e => setPAT(e.target.value)}
                  placeholder="Leave blank for public repos or SSH clones  ·  ghp_xxx for private HTTPS"
                  type="password" />
              </div>
            </>
          )}

          {tab === 'local' && (
            <>
              <div className="guide-tip" style={{ marginBottom: 16 }}>
                <Info size={15} style={{ flexShrink: 0 }} />
                <div>
                  Your home directory is mounted read-only inside the container.
                  Paste your normal Mac path — e.g. <code style={{ background: 'var(--bg-overlay)', padding: '1px 5px', borderRadius: 3 }}>/Users/chanfamily/ursa/git/templates</code> — it's translated automatically.
                </div>
              </div>
              <div className="form-group">
                <label className="form-label">Path to existing git repo *</label>
                <input className="form-input" value={rawPath} onChange={e => setRawPath(e.target.value)}
                  placeholder="/Users/chanfamily/ursa/git/templates" />
                {showTranslation && (
                  <div className="form-hint" style={{ color: 'var(--diff-add-text)' }}>
                    ✓ Inside container: <strong>{translatedPath}</strong>
                  </div>
                )}
              </div>
            </>
          )}

          {tab === 'new' && (
            <div className="guide-tip" style={{ marginBottom: 16 }}>
              <Info size={15} style={{ flexShrink: 0 }} />
              <div>Creates a brand-new empty git repo at <code style={{ background: 'var(--bg-overlay)', padding: '1px 5px', borderRadius: 3 }}>/repos/{name || 'your-name'}</code> inside the container.</div>
            </div>
          )}

          <div className="form-group">
            <label className="form-label">Repository Name *</label>
            <input className="form-input" value={name} onChange={e => setName(e.target.value)} placeholder="my-project" />
          </div>
          <div className="form-group">
            <label className="form-label">Description (optional)</label>
            <input className="form-input" value={desc} onChange={e => setDesc(e.target.value)} placeholder="What is this repo for?" />
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={submit} disabled={loading}>
            {loading
              ? <><div className="spinner" style={{ width: 14, height: 14 }} /> {tab === 'clone' ? 'Starting…' : 'Adding…'}</>
              : tab === 'clone' ? '📥 Clone' : tab === 'new' ? '🆕 Create' : '📁 Add Local Repo'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Edit Modal ────────────────────────────────────────────────────────────────
function EditRepoModal({ repo, onClose, onDone }: { repo: Repository; onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState(repo.name)
  const [desc, setDesc] = useState(repo.description || '')
  const [githubURL, setGithubURL] = useState(repo.github_url || '')

  const submit = async () => {
    await updateRepo(repo.id, { name, description: desc, github_url: githubURL })
    toast.success('Updated')
    onDone()
  }

  return (
    <div className="modal-overlay">
      <div className="modal">
        <div className="modal-header">
          <h3 style={{ fontWeight: 600 }}>Edit Repository</h3>
          <button className="btn btn-ghost btn-icon" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="modal-body">
          <div className="form-group">
            <label className="form-label">Name</label>
            <input className="form-input" value={name} onChange={e => setName(e.target.value)} />
          </div>
          <div className="form-group">
            <label className="form-label">GitHub URL</label>
            <input className="form-input" value={githubURL} onChange={e => setGithubURL(e.target.value)} placeholder="https://github.com/user/repo" />
          </div>
          <div className="form-group">
            <label className="form-label">Description</label>
            <input className="form-input" value={desc} onChange={e => setDesc(e.target.value)} />
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={submit}>Save</button>
        </div>
      </div>
    </div>
  )
}
