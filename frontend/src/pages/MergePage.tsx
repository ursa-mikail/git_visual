import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'react-hot-toast'
import { GitBranch, AlertTriangle, Check, RefreshCw } from 'lucide-react'
import { getBranches, mergeBranches, rebaseBranch, cherryPick, getCommits } from '../utils/api'
import { Branch, Commit, PaginatedResult } from '../types'

export default function MergePage() {
  const { repoId } = useParams<{ repoId: string }>()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [tab, setTab] = useState<'merge' | 'rebase' | 'cherry'>('merge')
  const [loading, setLoading] = useState(false)

  // Merge state
  const [mergeSource, setMergeSource] = useState('')
  const [mergeStrategy, setMergeStrategy] = useState('--no-ff')

  // Rebase state
  const [rebaseOnto, setRebaseOnto] = useState('')
  const [rebaseAbort, setRebaseAbort] = useState(false)

  // Cherry-pick state
  const [cherryHashes, setCherryHashes] = useState<Set<string>>(new Set())
  const [cherryBranch, setCherryBranch] = useState('')

  const { data: branches = [] } = useQuery<Branch[]>({ queryKey: ['branches', repoId], queryFn: () => getBranches(repoId!) })
  const { data: cherryCommitsData } = useQuery<PaginatedResult<Commit>>({
    queryKey: ['commits', repoId, 'cherry', cherryBranch],
    queryFn: () => getCommits(repoId!, { branch: cherryBranch, page: 1, page_size: 30 }),
    enabled: !!cherryBranch,
  })
  const cherryCommits: Commit[] = cherryCommitsData?.data || []

  const handleMerge = async () => {
    if (!mergeSource) { toast.error('Select source branch'); return }
    setLoading(true)
    try {
      const result = await mergeBranches(repoId!, { source: mergeSource, strategy: mergeStrategy })
      toast.success(result.message || 'Merged successfully!')
      qc.invalidateQueries({ queryKey: ['commits', repoId] })
      qc.invalidateQueries({ queryKey: ['branches', repoId] })
    } catch (e: unknown) {
      const err = e as { response?: { status?: number; data?: { has_conflicts?: boolean; output?: string } } }
      if (err?.response?.status === 409) {
        toast.error('Merge conflicts detected! Go to Conflict Resolver.')
        navigate(`/repos/${repoId}/conflicts`)
      } else {
        toast.error(err?.response?.data?.output || 'Merge failed')
      }
    } finally { setLoading(false) }
  }

  const handleRebase = async () => {
    if (!rebaseOnto) { toast.error('Select branch to rebase onto'); return }
    setLoading(true)
    try {
      const result = await rebaseBranch(repoId!, { onto: rebaseOnto })
      toast.success(result.message || 'Rebased successfully!')
      qc.invalidateQueries({ queryKey: ['commits', repoId] })
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } } }
      toast.error(err?.response?.data?.error || 'Rebase failed')
    } finally { setLoading(false) }
  }

  const handleCherryPick = async () => {
    if (cherryHashes.size === 0) { toast.error('Select at least one commit'); return }
    setLoading(true)
    try {
      const result = await cherryPick(repoId!, { hashes: Array.from(cherryHashes) })
      toast.success(result.message || 'Cherry-picked!')
      qc.invalidateQueries({ queryKey: ['commits', repoId] })
      setCherryHashes(new Set())
    } catch (e: unknown) {
      const err = e as { response?: { status?: number; data?: { has_conflicts?: boolean; output?: string } } }
      if (err?.response?.status === 409) {
        toast.error('Cherry-pick has conflicts! Go to Conflict Resolver.')
        navigate(`/repos/${repoId}/conflicts`)
      } else {
        toast.error(err?.response?.data?.output || 'Cherry-pick failed')
      }
    } finally { setLoading(false) }
  }

  const abortRebase = async () => {
    await rebaseBranch(repoId!, { abort: true })
    toast.success('Rebase aborted')
  }

  const abortCherryPick = async () => {
    await cherryPick(repoId!, { abort: true })
    toast.success('Cherry-pick aborted')
  }

  return (
    <div style={{ padding: 24 }}>
      <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 4 }}>Merge, Rebase &amp; Cherry-Pick</h1>
      <p style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 20 }}>
        Combine branches visually. Choose a strategy and GitVisual handles the git commands.
      </p>

      <div className="tabs" style={{ marginBottom: 20 }}>
        <button className={`tab ${tab === 'merge' ? 'active' : ''}`} onClick={() => setTab('merge')}>🔀 Merge</button>
        <button className={`tab ${tab === 'rebase' ? 'active' : ''}`} onClick={() => setTab('rebase')}>📐 Rebase</button>
        <button className={`tab ${tab === 'cherry' ? 'active' : ''}`} onClick={() => setTab('cherry')}>🍒 Cherry-Pick</button>
      </div>

      {tab === 'merge' && (
        <div style={{ maxWidth: 600 }}>
          <div className="guide-tip" style={{ marginBottom: 16 }}>
            <span style={{fontSize:16}}>ℹ️</span>
            <div>
              <strong>Merge</strong> combines branches. You're merging <em>source</em> INTO your current branch.
              <ul style={{ marginTop: 6, marginLeft: 16, fontSize: 12 }}>
                <li><strong>No Fast-Forward</strong> — creates a merge commit (recommended for features)</li>
                <li><strong>Squash</strong> — combines all commits into one clean commit</li>
                <li><strong>Fast-Forward Only</strong> — only merges if history is linear</li>
              </ul>
            </div>
          </div>

          <div className="card" style={{ padding: 20 }}>
            <div className="form-group">
              <label className="form-label">Source Branch (to merge IN FROM)</label>
              <select className="form-input" value={mergeSource} onChange={e => setMergeSource(e.target.value)}>
                <option value="">Select source branch…</option>
                {(branches as Branch[]).map((b: Branch) => <option key={b.id} value={b.name}>{b.name}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Merge Strategy</label>
              <select className="form-input" value={mergeStrategy} onChange={e => setMergeStrategy(e.target.value)}>
                <option value="--no-ff">No Fast-Forward (creates merge commit)</option>
                <option value="squash">Squash (one clean commit)</option>
                <option value="ff-only">Fast-Forward Only (linear history)</option>
              </select>
            </div>
            {mergeSource && (
              <div className="banner banner-info" style={{ marginBottom: 16 }}>
                <span>⚡</span>
                <span>Will merge <strong>{mergeSource}</strong> into current branch using <strong>{mergeStrategy}</strong></span>
              </div>
            )}
            <button className="btn btn-primary" onClick={handleMerge} disabled={loading || !mergeSource}>
              {loading ? <><div className="spinner" style={{ width: 14, height: 14 }} /> Merging…</> : '🔀 Merge'}
            </button>
          </div>
        </div>
      )}

      {tab === 'rebase' && (
        <div style={{ maxWidth: 600 }}>
          <div className="guide-tip" style={{ marginBottom: 16 }}>
            <span style={{fontSize:16}}>ℹ️</span>
            <div>
              <strong>Rebase</strong> replays your commits on top of another branch, creating a linear history.
              Use it to update your feature branch with latest main changes without a merge commit.
              <br /><em style={{ color: 'var(--accent-yellow)', fontSize: 12 }}>⚠ Never rebase commits that have been pushed to shared branches.</em>
            </div>
          </div>

          <div className="card" style={{ padding: 20 }}>
            <div className="form-group">
              <label className="form-label">Rebase Onto (target branch)</label>
              <select className="form-input" value={rebaseOnto} onChange={e => setRebaseOnto(e.target.value)}>
                <option value="">Select target branch…</option>
                {(branches as Branch[]).map((b: Branch) => <option key={b.id} value={b.name}>{b.name}</option>)}
              </select>
              <div className="form-hint">Your current branch's commits will be replayed on top of this</div>
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button className="btn btn-primary" onClick={handleRebase} disabled={loading || !rebaseOnto}>
                {loading ? 'Rebasing…' : '📐 Rebase'}
              </button>
              <button className="btn btn-danger" onClick={abortRebase}>⛔ Abort Rebase</button>
              <button className="btn btn-ghost" onClick={() => rebaseBranch(repoId!, { continue_rebase: true })}>
                ▶ Continue After Conflict Fix
              </button>
            </div>
          </div>
        </div>
      )}

      {tab === 'cherry' && (
        <div>
          <div className="guide-tip" style={{ marginBottom: 16 }}>
            <span style={{fontSize:16}}>ℹ️</span>
            <div>
              <strong>Cherry-Pick</strong> applies specific commits from any branch onto your current branch.
              Pick exactly the changes you want, without merging the whole branch.
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '260px 1fr', gap: 16 }}>
            <div className="card" style={{ padding: 16 }}>
              <div className="form-group">
                <label className="form-label">Pick commits from branch</label>
                <select className="form-input" value={cherryBranch} onChange={e => setCherryBranch(e.target.value)}>
                  <option value="">Select branch…</option>
                  {(branches as Branch[]).map((b: Branch) => <option key={b.id} value={b.name}>{b.name}</option>)}
                </select>
              </div>
              {cherryHashes.size > 0 && (
                <div style={{ marginBottom: 12 }}>
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 6 }}>Selected: {cherryHashes.size}</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {Array.from(cherryHashes).map((h: unknown) => (
                      <span key={h as string} className="tag">{(h as string).slice(0, 7)}</span>
                    ))}
                  </div>
                </div>
              )}
              <button className="btn btn-success" onClick={handleCherryPick} disabled={loading || cherryHashes.size === 0} style={{ width: '100%' }}>
                {loading ? 'Picking…' : `🍒 Cherry-Pick ${cherryHashes.size} commit(s)`}
              </button>
              <button className="btn btn-danger btn-sm" onClick={abortCherryPick} style={{ width: '100%', marginTop: 8 }}>⛔ Abort</button>
            </div>

            <div className="card" style={{ maxHeight: 500, overflow: 'auto' }}>
              {!cherryBranch ? (
                <div className="empty-state" style={{ padding: 32 }}>Select a branch to see its commits</div>
              ) : cherryCommits.length === 0 ? (
                <div className="empty-state" style={{ padding: 32 }}>No commits</div>
              ) : cherryCommits.map((c: Commit) => (
                <div key={c.id} onClick={() => setCherryHashes(s => {
                  const n = new Set(s)
                  if (n.has(c.hash)) n.delete(c.hash); else n.add(c.hash)
                  return n
                })} style={{ padding: '10px 14px', borderBottom: '1px solid var(--border-muted)', cursor: 'pointer', display: 'flex', gap: 10, alignItems: 'flex-start', background: cherryHashes.has(c.hash) ? 'rgba(26,188,156,0.1)' : 'transparent' }}>
                  <input type="checkbox" checked={cherryHashes.has(c.hash)} onChange={() => {}} style={{ marginTop: 2 }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: cherryHashes.has(c.hash) ? 600 : 400 }}>{c.message}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                      <code style={{ color: 'var(--accent-blue)' }}>{c.short_hash}</code>
                      {c.author_name && ` · ${c.author_name}`}
                      {' · '}{new Date(c.committed_at).toLocaleDateString()}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}


