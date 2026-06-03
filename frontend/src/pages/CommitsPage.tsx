import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'react-hot-toast'
import { GitCommit, RotateCcw, Search, Filter, ChevronLeft, ChevronRight, Plus, Minus, RefreshCw, FileText, Check } from 'lucide-react'
import { getCommits, getBranches, revertCommit, createCommit, stageFiles, getStatus } from '../utils/api'
import { Commit, Branch, FileStatus, PaginatedResult } from '../types'

export default function CommitsPage() {
  const { repoId } = useParams<{ repoId: string }>()
  const qc = useQueryClient()
  const [page, setPage] = useState(1)
  const [branch, setBranch] = useState('')
  const [search, setSearch] = useState('')
  const [author, setAuthor] = useState('')
  const [showCommit, setShowCommit] = useState(false)

  const { data: branchData = [] } = useQuery<Branch[]>({ queryKey: ['branches', repoId], queryFn: () => getBranches(repoId!) })
  const { data: statusData = [] } = useQuery<FileStatus[]>({ queryKey: ['status', repoId], queryFn: () => getStatus(repoId!), refetchInterval: 5000 })

  const { data, isLoading } = useQuery<PaginatedResult<Commit>>({
    queryKey: ['commits', repoId, page, branch, search, author],
    queryFn: () => getCommits(repoId!, { page, page_size: 25, branch: branch || undefined, search: search || undefined, author: author || undefined }),
  })

  const commits: Commit[] = data?.data || []
  const total = data?.total || 0
  const totalPages = data?.total_pages || 1
  const uncommitted = (statusData as FileStatus[]).filter((f: FileStatus) => f.working !== ' ' && f.working !== '?')

  const handleRevert = async (c: Commit) => {
    if (!confirm(`Revert commit "${c.message}"? This creates a new commit undoing these changes.`)) return
    try {
      await revertCommit(repoId!, c.id)
      toast.success('Reverted')
      qc.invalidateQueries({ queryKey: ['commits', repoId] })
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } } }
      toast.error(err?.response?.data?.error || 'Revert failed')
    }
  }

  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 700 }}>Commit History</h1>
          <p style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 2 }}>Browse, filter, and revert commits. Stage files and create new commits without git add / git commit.</p>
        </div>
        {uncommitted.length > 0 && (
          <button className="btn btn-success" onClick={() => setShowCommit(true)}>
            <GitCommit size={15} /> Commit Changes ({uncommitted.length} files)
          </button>
        )}
      </div>

      {uncommitted.length > 0 && (
        <div className="banner banner-warn" style={{ marginBottom: 16 }}>
          <FileText size={15} />
          <span>You have <strong>{uncommitted.length} uncommitted file(s)</strong>. Click "Commit Changes" to stage and commit them.</span>
        </div>
      )}

      {/* Filters */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
        <div style={{ position: 'relative' }}>
          <Search size={13} style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }} />
          <input value={search} onChange={e => { setSearch(e.target.value); setPage(1) }} placeholder="Search commits…" style={{ paddingLeft: 28, width: 200 }} />
        </div>
        <select value={branch} onChange={e => { setBranch(e.target.value); setPage(1) }} style={{ width: 180 }}>
          <option value="">All branches</option>
          {(branchData as Branch[]).filter((b: Branch) => !b.is_remote).map((b: Branch) => (
            <option key={b.id} value={b.name}>{b.name}</option>
          ))}
        </select>
        <input value={author} onChange={e => { setAuthor(e.target.value); setPage(1) }} placeholder="Filter by author…" style={{ width: 160 }} />
      </div>

      <div className="guide-tip" style={{ marginBottom: 16 }}>
        <span>💡</span>
        <div>
          <strong>Revert</strong> creates a new commit that undoes the changes — safe for shared branches.
          To jump to a specific state, use <strong>Reset</strong> in Advanced Ops.
        </div>
      </div>

      {isLoading ? (
        <div className="loading"><div className="spinner" /> Loading commits…</div>
      ) : commits.length === 0 ? (
        <div className="empty-state">
          <GitCommit size={48} />
          <p>No commits found{search ? ` matching "${search}"` : ''}</p>
        </div>
      ) : (
        <>
          <div className="card">
            {commits.map((c: Commit, i: number) => (
              <div key={c.id} style={{ padding: '12px 16px', borderBottom: i < commits.length - 1 ? '1px solid var(--border-muted)' : 'none', display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'var(--bg-overlay)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 2 }}>
                  <GitCommit size={14} color="var(--accent-blue)" />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 3 }}>{c.message}</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', fontSize: 12, color: 'var(--text-muted)' }}>
                    <code style={{ color: 'var(--accent-blue)', fontSize: 11 }}>{c.short_hash}</code>
                    {c.author_name && <span>👤 {c.author_name}</span>}
                    {c.branch_name && <span className="tag"><GitCommit size={10} />{c.branch_name}</span>}
                    <span>🕐 {new Date(c.committed_at).toLocaleString()}</span>
                    {(c.insertions > 0 || c.deletions > 0) && (
                      <span>
                        <span style={{ color: 'var(--diff-add-text)' }}>+{c.insertions}</span>
                        {' / '}
                        <span style={{ color: 'var(--accent-red-hover)' }}>-{c.deletions}</span>
                        {c.files_changed > 0 && <span style={{ marginLeft: 4 }}>· {c.files_changed} files</span>}
                      </span>
                    )}
                  </div>
                </div>
                <button className="btn btn-ghost btn-sm" onClick={() => handleRevert(c)} title="Revert this commit">
                  <RotateCcw size={12} /> Revert
                </button>
              </div>
            ))}
          </div>

          {/* Pagination */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 16 }}>
            <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>{total} total commits</span>
            <div style={{ display: 'flex', gap: 6 }}>
              <button className="btn btn-ghost btn-sm" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1}><ChevronLeft size={14} /></button>
              <span style={{ padding: '4px 12px', fontSize: 13, color: 'var(--text-secondary)' }}>{page} / {totalPages}</span>
              <button className="btn btn-ghost btn-sm" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages}><ChevronRight size={14} /></button>
            </div>
          </div>
        </>
      )}

      {showCommit && (
        <CommitModal repoId={repoId!} statusFiles={statusData as FileStatus[]} onClose={() => setShowCommit(false)}
          onDone={() => { setShowCommit(false); qc.invalidateQueries({ queryKey: ['commits', repoId] }); qc.invalidateQueries({ queryKey: ['status', repoId] }) }} />
      )}
    </div>
  )
}

function CommitModal({ repoId, statusFiles, onClose, onDone }: { repoId: string; statusFiles: FileStatus[]; onClose: () => void; onDone: () => void }) {
  const [message, setMessage] = useState('')
  const [staged, setStaged] = useState<Set<string>>(new Set(statusFiles.filter(f => f.index !== ' ' && f.index !== '?').map(f => f.path)))
  const [loading, setLoading] = useState(false)

  const toggle = (path: string) => {
    setStaged(s => { const n = new Set(s); if (n.has(path)) n.delete(path); else n.add(path); return n })
  }

  const stageAll = () => setStaged(new Set(statusFiles.map(f => f.path)))
  const unstageAll = () => setStaged(new Set())

  const submit = async () => {
    if (!message.trim()) { toast.error('Commit message required'); return }
    if (staged.size === 0) { toast.error('No files staged'); return }
    setLoading(true)
    try {
      await createCommit(repoId, { message, files: Array.from(staged) })
      toast.success('Committed!')
      onDone()
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } } }
      toast.error(err?.response?.data?.error || 'Commit failed')
    } finally { setLoading(false) }
  }

  const statusLabel = (f: FileStatus) => {
    const map: Record<string, string> = { 'M': 'Modified', 'A': 'Added', 'D': 'Deleted', 'R': 'Renamed', 'C': 'Copied', '?': 'Untracked', '!': 'Ignored' }
    return map[f.working] || map[f.index] || 'Changed'
  }

  const statusColor = (f: FileStatus) => {
    if (f.working === 'D' || f.index === 'D') return 'var(--accent-red-hover)'
    if (f.working === 'A' || f.index === 'A' || f.working === '?') return 'var(--diff-add-text)'
    return 'var(--accent-yellow)'
  }

  return (
    <div className="modal-overlay">
      <div className="modal modal-lg">
        <div className="modal-header">
          <h3 style={{ fontWeight: 600 }}>Create Commit</h3>
          <button className="btn btn-ghost btn-icon" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="modal-body">
          <div className="guide-tip">
            <span>💡</span>
            <span>Select which files to include in this commit, write a message, and click Commit. This replaces <code>git add</code> + <code>git commit</code>.</span>
          </div>

          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            <button className="btn btn-ghost btn-sm" onClick={stageAll}><Check size={12} /> Stage All</button>
            <button className="btn btn-ghost btn-sm" onClick={unstageAll}>Unstage All</button>
            <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--text-muted)' }}>{staged.size}/{statusFiles.length} files staged</span>
          </div>

          <div className="card" style={{ marginBottom: 16, maxHeight: 220, overflow: 'auto' }}>
            {statusFiles.map(f => (
              <div key={f.path} onClick={() => toggle(f.path)} style={{ padding: '7px 12px', display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', borderBottom: '1px solid var(--border-muted)', background: staged.has(f.path) ? 'rgba(31,111,235,0.08)' : 'transparent' }}>
                <input type="checkbox" checked={staged.has(f.path)} onChange={() => toggle(f.path)} onClick={e => e.stopPropagation()} />
                <span style={{ fontSize: 11, fontWeight: 600, color: statusColor(f), minWidth: 60 }}>{statusLabel(f)}</span>
                <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)' }}>{f.path}</span>
              </div>
            ))}
          </div>

          <div className="form-group">
            <label className="form-label">Commit Message *</label>
            <textarea className="form-input" value={message} onChange={e => setMessage(e.target.value)} rows={3} placeholder="feat: add awesome feature&#10;&#10;Describe what changed and why…" style={{ width: '100%', resize: 'vertical' }} />
            <div className="form-hint">First line should be short (50 chars). Add detail below a blank line.</div>
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-success" onClick={submit} disabled={loading || staged.size === 0}>
            {loading ? 'Committing…' : `✓ Commit ${staged.size} file(s)`}
          </button>
        </div>
      </div>
    </div>
  )
}

function X({ size }: { size: number }) {
  return <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
}
