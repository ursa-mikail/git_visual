import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'react-hot-toast'
import { GitPullRequest, Plus, Check, AlertTriangle, ExternalLink, ChevronDown } from 'lucide-react'
import { getPRs, createPR, mergePR, closePR, getBranches } from '../utils/api'
import { PullRequest, Branch } from '../types'

export default function PullRequestsPage() {
  const { repoId } = useParams<{ repoId: string }>()
  const qc = useQueryClient()
  const [statusFilter, setStatusFilter] = useState('open')
  const [showCreate, setShowCreate] = useState(false)
  const [merging, setMerging] = useState<string | null>(null)

  const { data: prs = [], isLoading } = useQuery<PullRequest[]>({
    queryKey: ['prs', repoId, statusFilter],
    queryFn: () => getPRs(repoId!, statusFilter),
  })

  const handleMerge = async (pr: PullRequest) => {
    setMerging(pr.id)
    try {
      await mergePR(repoId!, pr.id, { strategy: '--no-ff' })
      toast.success(`PR "${pr.title}" merged!`)
      qc.invalidateQueries({ queryKey: ['prs', repoId] })
    } catch (e: unknown) {
      const err = e as { response?: { status?: number; data?: { has_conflicts?: boolean } } }
      if (err?.response?.status === 409) {
        toast.error('Conflicts detected — resolve them first in Conflict Resolver')
      } else {
        toast.error('Merge failed')
      }
    } finally { setMerging(null) }
  }

  const handleClose = async (pr: PullRequest) => {
    if (!confirm(`Close PR "${pr.title}"?`)) return
    await closePR(repoId!, pr.id)
    toast.success('PR closed')
    qc.invalidateQueries({ queryKey: ['prs', repoId] })
  }

  const statusColor = (s: string) => s === 'open' ? 'badge-green' : s === 'merged' ? 'badge-purple' : 'badge-gray'

  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 700 }}>Pull Requests</h1>
          <p style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 2 }}>
            Create, review, and merge PRs. Conflict detection before merge — all visual.
          </p>
        </div>
        <button className="btn btn-primary" onClick={() => setShowCreate(true)}>
          <Plus size={15} /> New Pull Request
        </button>
      </div>

      <div className="guide-tip" style={{ marginBottom: 16 }}>
        <GitPullRequest size={15} style={{ flexShrink: 0, color: 'var(--text-link)' }} />
        <div>
          <strong>Pull Requests</strong> let you propose changes from one branch to another.
          GitVisual checks for conflicts before you merge, so you're never surprised.
          If there are conflicts, you'll be directed to the Conflict Resolver.
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        {['open', 'merged', 'closed'].map(s => (
          <button key={s} className={`btn ${statusFilter === s ? 'btn-primary' : 'btn-ghost'} btn-sm`}
            onClick={() => setStatusFilter(s)}>
            {s.charAt(0).toUpperCase() + s.slice(1)}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="loading"><div className="spinner" /> Loading…</div>
      ) : (prs as PullRequest[]).length === 0 ? (
        <div className="empty-state">
          <GitPullRequest size={48} />
          <p>No {statusFilter} pull requests</p>
          {statusFilter === 'open' && <button className="btn btn-primary" onClick={() => setShowCreate(true)}><Plus size={14} /> Create one</button>}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {(prs as PullRequest[]).map((pr: PullRequest) => (
            <div key={pr.id} className="card" style={{ padding: '14px 16px' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                <div style={{ marginTop: 2, color: pr.status === 'merged' ? 'var(--accent-purple)' : pr.status === 'open' ? 'var(--diff-add-text)' : 'var(--text-muted)' }}>
                  <GitPullRequest size={20} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <span style={{ fontWeight: 600, fontSize: 14 }}>{pr.title}</span>
                    <span className={`badge ${statusColor(pr.status)}`}>{pr.status}</span>
                    {pr.has_conflicts && <span className="badge badge-red"><AlertTriangle size={10} /> conflicts</span>}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                    <span>
                      <span style={{ color: 'var(--accent-blue)', fontFamily: 'var(--font-mono)' }}>{pr.source_branch}</span>
                      {' → '}
                      <span style={{ color: 'var(--accent-green)', fontFamily: 'var(--font-mono)' }}>{pr.target_branch}</span>
                    </span>
                    {pr.author && <span>by {pr.author}</span>}
                    <span>{new Date(pr.created_at).toLocaleDateString()}</span>
                    {pr.reviewers?.length > 0 && <span>reviewers: {pr.reviewers.join(', ')}</span>}
                    {pr.github_pr_url && (
                      <a href={pr.github_pr_url} target="_blank" rel="noreferrer" style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                        <ExternalLink size={11} /> View on GitHub
                      </a>
                    )}
                  </div>
                  {pr.description && <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 6 }}>{pr.description}</p>}
                </div>
                {pr.status === 'open' && (
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button className="btn btn-success btn-sm" onClick={() => handleMerge(pr)} disabled={merging === pr.id}>
                      {merging === pr.id ? 'Merging…' : <><Check size={12} /> Merge</>}
                    </button>
                    <button className="btn btn-ghost btn-sm" onClick={() => handleClose(pr)}>Close</button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {showCreate && (
        <CreatePRModal repoId={repoId!} onClose={() => setShowCreate(false)}
          onDone={() => { setShowCreate(false); qc.invalidateQueries({ queryKey: ['prs', repoId] }) }} />
      )}
    </div>
  )
}

function CreatePRModal({ repoId, onClose, onDone }: { repoId: string; onClose: () => void; onDone: () => void }) {
  const [title, setTitle] = useState('')
  const [desc, setDesc] = useState('')
  const [source, setSource] = useState('')
  const [target, setTarget] = useState('main')
  const [author, setAuthor] = useState('')
  const [reviewers, setReviewers] = useState('')
  const [loading, setLoading] = useState(false)

  const { data: branches = [] } = useQuery<Branch[]>({ queryKey: ['branches', repoId], queryFn: () => getBranches(repoId) })

  const submit = async () => {
    if (!title || !source) { toast.error('Title and source branch required'); return }
    setLoading(true)
    try {
      const reviewerList = reviewers.split(',').map(r => r.trim()).filter(Boolean)
      await createPR(repoId, { title, description: desc, source_branch: source, target_branch: target, author, reviewers: reviewerList })
      toast.success('Pull request created!')
      onDone()
    } catch { toast.error('Failed to create PR') }
    finally { setLoading(false) }
  }

  return (
    <div className="modal-overlay">
      <div className="modal modal-lg">
        <div className="modal-header">
          <h3 style={{ fontWeight: 600 }}><span style={{marginRight:6}}>📋</span>New Pull Request</h3>
          <button className="btn btn-ghost btn-icon" onClick={onClose}><span>⚡</span></button>
        </div>
        <div className="modal-body">
          <div className="guide-tip">
            <span>💡</span>
            <span>A pull request proposes merging <strong>source</strong> into <strong>target</strong>. GitVisual will automatically check for merge conflicts when you create it.</span>
          </div>
          <div className="form-group">
            <label className="form-label">Title *</label>
            <input className="form-input" value={title} onChange={e => setTitle(e.target.value)} placeholder="feat: add user authentication" autoFocus />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div className="form-group">
              <label className="form-label">Source Branch *</label>
              <select className="form-input" value={source} onChange={e => setSource(e.target.value)}>
                <option value="">Select…</option>
                {(branches as Branch[]).map((b: Branch) => <option key={b.id} value={b.name}>{b.name}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Target Branch</label>
              <select className="form-input" value={target} onChange={e => setTarget(e.target.value)}>
                {(branches as Branch[]).map((b: Branch) => <option key={b.id} value={b.name}>{b.name}</option>)}
              </select>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div className="form-group">
              <label className="form-label">Author</label>
              <input className="form-input" value={author} onChange={e => setAuthor(e.target.value)} placeholder="your-name" />
            </div>
            <div className="form-group">
              <label className="form-label">Reviewers</label>
              <input className="form-input" value={reviewers} onChange={e => setReviewers(e.target.value)} placeholder="alice, bob (comma-separated)" />
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">Description</label>
            <textarea className="form-input" value={desc} onChange={e => setDesc(e.target.value)} rows={4}
              placeholder="What does this PR do? Why is it needed?" style={{ width: '100%', resize: 'vertical' }} />
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={submit} disabled={loading}>
            {loading ? 'Creating…' : '✓ Create Pull Request'}
          </button>
        </div>
      </div>
    </div>
  )
}

