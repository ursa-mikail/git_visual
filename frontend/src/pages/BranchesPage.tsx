import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'react-hot-toast'
import { GitBranch, Plus, Trash2, Edit2, Check, GitMerge, ArrowRight, Search, Shield, Globe, X, RefreshCw } from 'lucide-react'
import { getBranches, createBranch, deleteBranch, renameBranch, checkoutBranch, syncRepo } from '../utils/api'
import { Branch } from '../types'

export default function BranchesPage() {
  const { repoId } = useParams<{ repoId: string }>()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [renaming, setRenaming] = useState<Branch | null>(null)
  const [syncing, setSyncing] = useState(false)

  const { data: branches = [], isLoading } = useQuery<Branch[]>({
    queryKey: ['branches', repoId, search],
    queryFn: () => getBranches(repoId!, search),
    refetchInterval: 15000,
  })

  const localBranches = (branches as Branch[]).filter((b: Branch) => !b.is_remote)
  const remoteBranches = (branches as Branch[]).filter((b: Branch) => b.is_remote)

  const handleSync = async () => {
    setSyncing(true)
    try { await syncRepo(repoId!); qc.invalidateQueries({ queryKey: ['branches', repoId] }); toast.success('Synced with real git') }
    catch { toast.error('Sync failed') }
    finally { setSyncing(false) }
  }

  const handleCheckout = async (b: Branch) => {
    try {
      await checkoutBranch(repoId!, b.id)
      toast.success(`Switched to branch: ${b.name}`)
      qc.invalidateQueries({ queryKey: ['branches', repoId] })
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } } }
      toast.error(err?.response?.data?.error || 'Checkout failed')
    }
  }

  const handleDelete = async (b: Branch) => {
    const force = b.is_protected ? false : confirm(`Force delete "${b.name}"? (use if branch is not fully merged)`)
    if (!confirm(`Delete branch "${b.name}"?`)) return
    try {
      await deleteBranch(repoId!, b.id, force)
      toast.success(`Deleted: ${b.name}`)
      qc.invalidateQueries({ queryKey: ['branches', repoId] })
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } } }
      toast.error(err?.response?.data?.error || 'Delete failed — try force delete')
    }
  }

  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 700 }}>Branches</h1>
          <p style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 2 }}>
            Switch branches, create from any point, rename, compare, or delete — all without git checkout.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-ghost btn-sm" onClick={handleSync} disabled={syncing}>
            <RefreshCw size={13} className={syncing ? 'spin' : ''} /> Sync from git
          </button>
          <button className="btn btn-primary" onClick={() => setShowCreate(true)}>
            <Plus size={15} /> New Branch
          </button>
        </div>
      </div>

      <div className="guide-tip" style={{ marginBottom: 16 }}>
        <span>💡</span>
        <div>
          <strong>How it works:</strong> Click <strong>Switch To</strong> to checkout a branch. Click the diff icon to compare branches side-by-side.
          Protected branches (like <code style={{ background: 'var(--bg-overlay)', padding: '0 4px', borderRadius: 3 }}>main</code>) cannot be force-deleted.
        </div>
      </div>

      <div style={{ position: 'relative', marginBottom: 16, maxWidth: 400 }}>
        <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }} />
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Filter branches…" style={{ width: '100%', paddingLeft: 32 }} />
      </div>

      {isLoading ? (
        <div className="loading"><div className="spinner" /> Loading branches…</div>
      ) : (
        <>
          <BranchSection title="Local Branches" icon={<GitBranch size={15} />} branches={localBranches}
            onCheckout={handleCheckout} onDelete={handleDelete} onRename={setRenaming}
            onDiff={b => navigate(`/repos/${repoId}/diff?branch=${b.name}`)} repoId={repoId!} />

          {remoteBranches.length > 0 && (
            <BranchSection title="Remote Tracking Branches" icon={<Globe size={15} />} branches={remoteBranches}
              onCheckout={handleCheckout} onDelete={handleDelete} onRename={setRenaming}
              onDiff={b => navigate(`/repos/${repoId}/diff?branch=${b.name}`)} repoId={repoId!} />
          )}
        </>
      )}

      {showCreate && <CreateBranchModal repoId={repoId!} branches={branches as Branch[]} onClose={() => setShowCreate(false)}
        onDone={() => { setShowCreate(false); qc.invalidateQueries({ queryKey: ['branches', repoId] }) }} />}
      {renaming && <RenameBranchModal branch={renaming} repoId={repoId!} onClose={() => setRenaming(null)}
        onDone={() => { setRenaming(null); qc.invalidateQueries({ queryKey: ['branches', repoId] }) }} />}
    </div>
  )
}

function BranchSection({ title, icon, branches, onCheckout, onDelete, onRename, onDiff, repoId }:
  { title: string; icon: React.ReactNode; branches: Branch[]; onCheckout: (b: Branch) => void; onDelete: (b: Branch) => void; onRename: (b: Branch) => void; onDiff: (b: Branch) => void; repoId: string }) {
  if (branches.length === 0) return null
  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="card-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {icon}
          <span style={{ fontWeight: 600 }}>{title}</span>
          <span className="badge badge-gray">{branches.length}</span>
        </div>
      </div>
      {branches.map(b => (
        <div key={b.id} style={{ padding: '10px 16px', borderBottom: '1px solid var(--border-muted)', display: 'flex', alignItems: 'center', gap: 12 }}>
          <GitBranch size={14} color="var(--accent-blue)" style={{ flexShrink: 0 }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontWeight: 600, fontSize: 13, fontFamily: 'var(--font-mono)' }}>{b.name}</span>
              {b.is_protected && <span className="badge badge-yellow" style={{ fontSize: 10 }}><Shield size={9} /> Protected</span>}
              {b.upstream && <span className="badge badge-gray" style={{ fontSize: 10 }}>↑ {b.upstream}</span>}
            </div>
            {b.last_commit_message && (
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {b.last_commit_hash && <code style={{ fontSize: 11, color: 'var(--accent-blue)', marginRight: 6 }}>{b.last_commit_hash.slice(0, 7)}</code>}
                {b.last_commit_message}
                {b.last_commit_author && <span style={{ marginLeft: 6 }}>· {b.last_commit_author}</span>}
              </div>
            )}
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="btn btn-ghost btn-sm" onClick={() => onCheckout(b)} title="Switch to this branch">
              <Check size={12} /> Switch To
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => onDiff(b)} title="Compare this branch">
              <ArrowRight size={12} /> Diff
            </button>
            {!b.is_remote && <button className="btn btn-ghost btn-icon" onClick={() => onRename(b)} title="Rename"><Edit2 size={13} /></button>}
            {!b.is_protected && <button className="btn btn-ghost btn-icon" onClick={() => onDelete(b)} title="Delete" style={{ color: 'var(--accent-red-hover)' }}><Trash2 size={13} /></button>}
          </div>
        </div>
      ))}
    </div>
  )
}

function CreateBranchModal({ repoId, branches, onClose, onDone }: { repoId: string; branches: Branch[]; onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState('')
  const [from, setFrom] = useState('')
  const [checkout, setCheckout] = useState(true)
  const [loading, setLoading] = useState(false)

  const submit = async () => {
    if (!name) { toast.error('Branch name required'); return }
    setLoading(true)
    try {
      await createBranch(repoId, { name, from: from || 'HEAD', checkout })
      toast.success(`Branch "${name}" created${checkout ? ' and checked out' : ''}`)
      onDone()
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } } }
      toast.error(err?.response?.data?.error || 'Failed')
    } finally { setLoading(false) }
  }

  return (
    <div className="modal-overlay">
      <div className="modal">
        <div className="modal-header">
          <h3 style={{ fontWeight: 600 }}><GitBranch size={15} style={{ display: 'inline', marginRight: 6 }} />Create New Branch</h3>
          <button className="btn btn-ghost btn-icon" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="modal-body">
          <div className="guide-tip">
            <span>💡</span>
            <span>Branches let you work on features without touching <code>main</code>. Create a branch, make changes, then merge back.</span>
          </div>
          <div className="form-group">
            <label className="form-label">Branch Name *</label>
            <input className="form-input" value={name} onChange={e => setName(e.target.value.replace(/\s+/g, '-'))} placeholder="feature/my-feature" autoFocus />
            <div className="form-hint">Use lowercase, hyphens. e.g. feature/login, fix/header-bug</div>
          </div>
          <div className="form-group">
            <label className="form-label">Branch From</label>
            <select className="form-input" value={from} onChange={e => setFrom(e.target.value)}>
              <option value="">HEAD (current position)</option>
              {branches.filter(b => !b.is_remote).map(b => (
                <option key={b.id} value={b.name}>{b.name}</option>
              ))}
            </select>
            <div className="form-hint">Which branch or commit to start from</div>
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
            <input type="checkbox" checked={checkout} onChange={e => setCheckout(e.target.checked)} />
            <span style={{ fontSize: 13 }}>Switch to this branch immediately after creating</span>
          </label>
        </div>
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={submit} disabled={loading}>
            {loading ? 'Creating…' : '✓ Create Branch'}
          </button>
        </div>
      </div>
    </div>
  )
}

function RenameBranchModal({ branch, repoId, onClose, onDone }: { branch: Branch; repoId: string; onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState(branch.name)
  const submit = async () => {
    try { await renameBranch(repoId, branch.id, name); toast.success('Branch renamed'); onDone() }
    catch { toast.error('Rename failed') }
  }
  return (
    <div className="modal-overlay">
      <div className="modal">
        <div className="modal-header">
          <h3 style={{ fontWeight: 600 }}>Rename Branch</h3>
          <button className="btn btn-ghost btn-icon" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="modal-body">
          <div className="form-group">
            <label className="form-label">New Name</label>
            <input className="form-input" value={name} onChange={e => setName(e.target.value)} autoFocus />
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={submit}>Rename</button>
        </div>
      </div>
    </div>
  )
}
