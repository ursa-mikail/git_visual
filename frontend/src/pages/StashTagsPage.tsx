import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'react-hot-toast'
import { Archive, Tag as TagIcon, Plus, Trash2, Play, ArrowDown, X, Info } from 'lucide-react'
import { getStashes, createStash, applyStash, popStash, dropStash, getTags, createTag, deleteTag } from '../utils/api'
import { Stash, Tag } from '../types'

export default function StashTagsPage() {
  const { repoId } = useParams<{ repoId: string }>()
  const [tab, setTab] = useState<'stash' | 'tags'>('stash')

  return (
    <div style={{ padding: 24 }}>
      <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 4 }}>Stash &amp; Tags</h1>
      <p style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 20 }}>
        Save work in progress without committing. Create version tags for releases.
      </p>
      <div className="tabs" style={{ marginBottom: 20 }}>
        <button className={`tab ${tab === 'stash' ? 'active' : ''}`} onClick={() => setTab('stash')}>📦 Stash</button>
        <button className={`tab ${tab === 'tags' ? 'active' : ''}`} onClick={() => setTab('tags')}>🏷️ Tags</button>
      </div>
      {tab === 'stash' ? <StashPanel repoId={repoId!} /> : <TagsPanel repoId={repoId!} />}
    </div>
  )
}

function StashPanel({ repoId }: { repoId: string }) {
  const qc = useQueryClient()
  const [showCreate, setShowCreate] = useState(false)
  const [message, setMessage] = useState('')
  const [includeUntracked, setIncludeUntracked] = useState(true)
  const [loading, setLoading] = useState(false)

  const { data: stashes = [], isLoading } = useQuery<Stash[]>({
    queryKey: ['stashes', repoId],
    queryFn: () => getStashes(repoId),
  })

  const handleCreate = async () => {
    setLoading(true)
    try {
      await createStash(repoId, { message, include_untracked: includeUntracked })
      toast.success('Changes stashed!')
      setShowCreate(false); setMessage('')
      qc.invalidateQueries({ queryKey: ['stashes', repoId] })
    } catch { toast.error('Stash failed — make sure you have changes to stash') }
    finally { setLoading(false) }
  }

  const handleApply = async (s: Stash) => {
    try { await applyStash(repoId, s.id); toast.success('Stash applied'); qc.invalidateQueries({ queryKey: ['stashes', repoId] }) }
    catch { toast.error('Apply failed') }
  }

  const handlePop = async (s: Stash) => {
    try { await popStash(repoId, s.id); toast.success('Stash popped (applied + dropped)'); qc.invalidateQueries({ queryKey: ['stashes', repoId] }) }
    catch { toast.error('Pop failed') }
  }

  const handleDrop = async (s: Stash) => {
    if (!confirm('Drop this stash? It cannot be recovered.')) return
    try { await dropStash(repoId, s.id); toast.success('Stash dropped'); qc.invalidateQueries({ queryKey: ['stashes', repoId] }) }
    catch { toast.error('Drop failed') }
  }

  return (
    <div style={{ maxWidth: 700 }}>
      <div className="guide-tip" style={{ marginBottom: 16 }}>
        <Archive size={15} style={{ flexShrink: 0, color: 'var(--text-link)' }} />
        <div>
          <strong>Stash</strong> saves your current uncommitted changes temporarily so you can switch branches or do other work.
          <ul style={{ marginTop: 6, marginLeft: 16, fontSize: 12 }}>
            <li><strong>Apply</strong> — restore stash, keep it in the list</li>
            <li><strong>Pop</strong> — restore stash and remove it from the list</li>
            <li><strong>Drop</strong> — delete the stash permanently</li>
          </ul>
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
        <button className="btn btn-primary" onClick={() => setShowCreate(s => !s)}>
          <Plus size={14} /> Stash Current Changes
        </button>
      </div>

      {showCreate && (
        <div className="card" style={{ padding: 16, marginBottom: 16 }}>
          <div className="form-group">
            <label className="form-label">Stash Message (optional)</label>
            <input className="form-input" value={message} onChange={e => setMessage(e.target.value)} placeholder="WIP: half-done feature…" autoFocus />
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', marginBottom: 12 }}>
            <input type="checkbox" checked={includeUntracked} onChange={e => setIncludeUntracked(e.target.checked)} />
            <span style={{ fontSize: 13 }}>Include untracked files</span>
          </label>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-primary btn-sm" onClick={handleCreate} disabled={loading}>
              {loading ? 'Stashing…' : '📦 Stash'}
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => setShowCreate(false)}>Cancel</button>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="loading"><div className="spinner" /></div>
      ) : (stashes as Stash[]).length === 0 ? (
        <div className="empty-state">
          <Archive size={40} />
          <p>No stashes yet</p>
          <p style={{ fontSize: 13 }}>Stash your work-in-progress before switching branches</p>
        </div>
      ) : (
        <div className="card">
          {(stashes as Stash[]).map((s: Stash, i: number) => (
            <div key={s.id} style={{ padding: '12px 16px', borderBottom: i < (stashes as Stash[]).length - 1 ? '1px solid var(--border-muted)' : 'none', display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ width: 32, height: 32, borderRadius: 6, background: 'var(--bg-overlay)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--accent-orange)', flexShrink: 0 }}>
                <Archive size={14} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 13 }}>stash@{'{' + i + '}'}: {s.message || 'WIP'}</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  {s.branch_name && <span>on {s.branch_name} · </span>}
                  {new Date(s.created_at).toLocaleString()}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button className="btn btn-ghost btn-sm" onClick={() => handleApply(s)}><Play size={12} /> Apply</button>
                <button className="btn btn-success btn-sm" onClick={() => handlePop(s)}><ArrowDown size={12} /> Pop</button>
                <button className="btn btn-ghost btn-icon" onClick={() => handleDrop(s)} style={{ color: 'var(--accent-red-hover)' }}><Trash2 size={13} /></button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function TagsPanel({ repoId }: { repoId: string }) {
  const qc = useQueryClient()
  const [showCreate, setShowCreate] = useState(false)
  const [tagName, setTagName] = useState('')
  const [tagMsg, setTagMsg] = useState('')
  const [tagHash, setTagHash] = useState('')
  const [pushTag, setPushTag] = useState(false)
  const [loading, setLoading] = useState(false)

  const { data: tags = [], isLoading } = useQuery<Tag[]>({
    queryKey: ['tags', repoId],
    queryFn: () => getTags(repoId),
  })

  const handleCreate = async () => {
    if (!tagName) { toast.error('Tag name required'); return }
    setLoading(true)
    try {
      await createTag(repoId, { name: tagName, message: tagMsg, commit_hash: tagHash, push: pushTag })
      toast.success(`Tag "${tagName}" created${pushTag ? ' and pushed' : ''}`)
      setShowCreate(false); setTagName(''); setTagMsg(''); setTagHash('')
      qc.invalidateQueries({ queryKey: ['tags', repoId] })
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } } }
      toast.error(err?.response?.data?.error || 'Tag creation failed')
    } finally { setLoading(false) }
  }

  const handleDelete = async (t: Tag) => {
    const remote = confirm(`Also delete tag "${t.name}" from remote?`)
    try {
      await deleteTag(repoId, t.id, remote)
      toast.success(`Tag deleted${remote ? ' locally and remotely' : ''}`)
      qc.invalidateQueries({ queryKey: ['tags', repoId] })
    } catch { toast.error('Delete failed') }
  }

  return (
    <div style={{ maxWidth: 700 }}>
      <div className="guide-tip" style={{ marginBottom: 16 }}>
        <TagIcon size={15} style={{ flexShrink: 0, color: 'var(--text-link)' }} />
        <div>
          <strong>Tags</strong> mark specific commits as releases or milestones (e.g. v1.0.0).
          <ul style={{ marginTop: 6, marginLeft: 16, fontSize: 12 }}>
            <li><strong>Lightweight tag</strong> — just a pointer to a commit</li>
            <li><strong>Annotated tag</strong> — includes a message, author, date (recommended for releases)</li>
          </ul>
          Tags follow semantic versioning: <code style={{ background: 'var(--bg-overlay)', padding: '0 4px', borderRadius: 3 }}>v1.2.3</code>
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
        <button className="btn btn-primary" onClick={() => setShowCreate(s => !s)}>
          <Plus size={14} /> Create Tag
        </button>
      </div>

      {showCreate && (
        <div className="card" style={{ padding: 16, marginBottom: 16 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
            <div className="form-group" style={{ margin: 0 }}>
              <label className="form-label">Tag Name *</label>
              <input className="form-input" value={tagName} onChange={e => setTagName(e.target.value)} placeholder="v1.0.0" autoFocus />
            </div>
            <div className="form-group" style={{ margin: 0 }}>
              <label className="form-label">Commit Hash (optional)</label>
              <input className="form-input" value={tagHash} onChange={e => setTagHash(e.target.value)} placeholder="abc1234 (blank = HEAD)" />
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">Message (creates annotated tag)</label>
            <input className="form-input" value={tagMsg} onChange={e => setTagMsg(e.target.value)} placeholder="Release v1.0.0 — initial stable release" />
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', marginBottom: 12 }}>
            <input type="checkbox" checked={pushTag} onChange={e => setPushTag(e.target.checked)} />
            <span style={{ fontSize: 13 }}>Push tag to remote immediately</span>
          </label>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-primary btn-sm" onClick={handleCreate} disabled={loading}>
              {loading ? 'Creating…' : '🏷️ Create Tag'}
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => setShowCreate(false)}>Cancel</button>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="loading"><div className="spinner" /></div>
      ) : (tags as Tag[]).length === 0 ? (
        <div className="empty-state">
          <TagIcon size={40} />
          <p>No tags yet</p>
          <p style={{ fontSize: 13 }}>Create a tag to mark a release or milestone</p>
        </div>
      ) : (
        <div className="card">
          {(tags as Tag[]).map((t: Tag, i: number) => (
            <div key={t.id} style={{ padding: '12px 16px', borderBottom: i < (tags as Tag[]).length - 1 ? '1px solid var(--border-muted)' : 'none', display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ color: 'var(--accent-yellow)', fontSize: 18 }}>🏷️</div>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontWeight: 700, fontSize: 13, fontFamily: 'var(--font-mono)' }}>{t.name}</span>
                  {t.is_annotated && <span className="badge badge-blue">annotated</span>}
                  {t.commit_hash && <code style={{ fontSize: 11, color: 'var(--text-muted)' }}>{t.commit_hash.slice(0, 7)}</code>}
                </div>
                {t.message && <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{t.message}</div>}
              </div>
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{new Date(t.created_at).toLocaleDateString()}</span>
              <button className="btn btn-ghost btn-icon" onClick={() => handleDelete(t)} style={{ color: 'var(--accent-red-hover)' }}><Trash2 size={13} /></button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
