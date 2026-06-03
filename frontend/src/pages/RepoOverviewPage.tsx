import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'react-hot-toast'
import {
  GitBranch, GitCommit, GitPullRequest, RefreshCw, ExternalLink,
  Folder, FileText, Globe, ArrowRight, Clock, Plus, Upload, Download,
  AlertTriangle, CheckCircle, Circle, ChevronRight, Activity,
} from 'lucide-react'
import {
  getRepo, getBranches, getCommits, getRemotes, getStatus, syncRepo,
} from '../utils/api'
import { Repository, Branch, Commit, RemoteInfo, FileStatus } from '../types'

export default function RepoOverviewPage() {
  const { repoId } = useParams<{ repoId: string }>()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [syncing, setSyncing] = useState(false)

  const { data: repo } = useQuery<Repository>({
    queryKey: ['repo', repoId],
    queryFn: () => getRepo(repoId!),
  })

  const { data: branches = [] } = useQuery<Branch[]>({
    queryKey: ['branches', repoId, ''],
    queryFn: () => getBranches(repoId!),
  })

  const { data: commitsData } = useQuery<{ data: Commit[]; total: number }>({
    queryKey: ['commits', repoId, 'overview'],
    queryFn: () => getCommits(repoId!, { limit: 10, page: 1 }),
  })

  const { data: remotes = [] } = useQuery<RemoteInfo[]>({
    queryKey: ['remotes', repoId],
    queryFn: () => getRemotes(repoId!),
  })

  const { data: status = [] } = useQuery<FileStatus[]>({
    queryKey: ['status', repoId],
    queryFn: () => getStatus(repoId!),
    refetchInterval: 10000,
  })

  const handleSync = async () => {
    setSyncing(true)
    try {
      await syncRepo(repoId!)
      qc.invalidateQueries({ queryKey: ['branches', repoId] })
      qc.invalidateQueries({ queryKey: ['commits', repoId] })
      qc.invalidateQueries({ queryKey: ['status', repoId] })
      toast.success('Synced with git')
    } catch {
      toast.error('Sync failed')
    } finally {
      setSyncing(false)
    }
  }

  const commits: Commit[] = commitsData?.data || []
  const localBranches = (branches as Branch[]).filter(b => !b.is_remote)
  const remoteBranches = (branches as Branch[]).filter(b => b.is_remote)
  const currentBranch = localBranches.find(b => b.name === repo?.default_branch) || localBranches[0]
  const changedFiles = (status as FileStatus[]).filter(f => f.index !== ' ' || f.working !== ' ')
  const untracked = (status as FileStatus[]).filter(f => f.index === '?' || f.working === '?')

  if (!repo) {
    return <div className="loading" style={{ padding: 40 }}><div className="spinner" /> Loading…</div>
  }

  const remoteURL = repo.remote_url || repo.github_url || (remotes as RemoteInfo[])[0]?.url || ''
  const isGitHub = remoteURL.includes('github.com')
  const isGitLab = remoteURL.includes('gitlab.com')
  const webURL = repo.github_url ||
    (isGitHub ? remoteURL.replace(/\.git$/, '').replace('git@github.com:', 'https://github.com/') : '') ||
    (isGitLab ? remoteURL.replace(/\.git$/, '').replace('git@gitlab.com:', 'https://gitlab.com/') : '')

  return (
    <div style={{ padding: 24, maxWidth: 1100 }}>

      {/* Cloning banner */}
      {!repo.is_initialized && (
        <div className="guide-tip" style={{ marginBottom: 20, borderColor: 'var(--accent-yellow)', background: 'rgba(210,168,0,0.08)' }}>
          <div className="spinner" style={{ width: 16, height: 16, flexShrink: 0 }} />
          <div style={{ flex: 1 }}>
            <strong>Repository not ready yet.</strong> If you just cloned it, the clone is running in the background.
            Hit <strong>Sync</strong> once cloning finishes to load branches and commits.
          </div>
          <button className="btn btn-ghost btn-sm" onClick={handleSync} disabled={syncing}>
            <RefreshCw size={12} className={syncing ? 'spin' : ''} /> Sync now
          </button>
        </div>
      )}

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 24 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
            <h1 style={{ fontSize: 22, fontWeight: 700 }}>{repo.name}</h1>
            {repo.is_initialized
              ? <span className="badge badge-green">✓ git repo</span>
              : <span className="badge badge-gray">not initialized</span>}
            {currentBranch && (
              <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 13, color: 'var(--text-muted)', background: 'var(--bg-overlay)', padding: '2px 10px', borderRadius: 20 }}>
                <GitBranch size={12} /> {currentBranch.name}
              </span>
            )}
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-muted)', display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <span>📁 {repo.path}</span>
            {repo.description && <span>· {repo.description}</span>}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <button className="btn btn-ghost btn-sm" onClick={handleSync} disabled={syncing}>
            <RefreshCw size={13} className={syncing ? 'spin' : ''} /> Sync
          </button>
          {webURL && (
            <a href={webURL} target="_blank" rel="noreferrer" className="btn btn-ghost btn-sm">
              {isGitHub ? '🐙' : isGitLab ? '🦊' : <Globe size={13} />} View Remote ↗
            </a>
          )}
          <button className="btn btn-primary btn-sm" onClick={() => navigate(`/repos/${repoId}/advanced`)}>
            <Upload size={13} /> Push / Pull
          </button>
        </div>
      </div>

      {/* Working tree status banner */}
      {changedFiles.length > 0 && (
        <div className="banner banner-warn" style={{ marginBottom: 20 }}>
          <AlertTriangle size={15} />
          <span>
            <strong>{changedFiles.length} uncommitted change{changedFiles.length !== 1 ? 's' : ''}</strong>
            {untracked.length > 0 && ` · ${untracked.length} untracked`}
            {' — '}
          </span>
          <button className="btn btn-ghost btn-sm" style={{ padding: '1px 8px' }}
            onClick={() => navigate(`/repos/${repoId}/commits`)}>
            Stage &amp; Commit <ArrowRight size={12} />
          </button>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 20 }}>

        {/* Quick actions */}
        <div className="card" style={{ padding: 16 }}>
          <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 14, color: 'var(--text-secondary)' }}>Quick Actions</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            {[
              { icon: <GitBranch size={15} />, label: 'Branches', sub: `${localBranches.length} local`, path: 'branches', color: 'var(--accent-blue)' },
              { icon: <GitCommit size={15} />, label: 'Commits', sub: `${commitsData?.total ?? 0} total`, path: 'commits', color: 'var(--accent-green)' },
              { icon: <FileText size={15} />, label: 'Diff Viewer', sub: 'Side-by-side', path: 'diff', color: 'var(--accent-orange)' },
              { icon: <GitPullRequest size={15} />, label: 'Pull Requests', sub: 'Create & review', path: 'prs', color: 'var(--accent-purple)' },
              { icon: <Upload size={15} />, label: 'Push / Pull', sub: 'Sync remotes', path: 'advanced', color: 'var(--accent-teal)' },
              { icon: <Activity size={15} />, label: 'Blame', sub: 'Line history', path: 'blame', color: 'var(--accent-yellow)' },
            ].map(a => (
              <button key={a.path} onClick={() => navigate(`/repos/${repoId}/${a.path}`)}
                style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', background: 'var(--bg-overlay)', border: '1px solid var(--border-muted)', borderRadius: 8, cursor: 'pointer', textAlign: 'left' }}
                className="hover-row">
                <div style={{ color: a.color, background: `color-mix(in srgb, ${a.color} 15%, transparent)`, padding: 7, borderRadius: 7, flexShrink: 0 }}>{a.icon}</div>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 600 }}>{a.label}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{a.sub}</div>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Branch overview */}
        <div className="card">
          <div className="card-header">
            <span style={{ fontWeight: 600, fontSize: 13 }}>
              <GitBranch size={13} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 6 }} />
              Branches
            </span>
            <button className="btn btn-ghost btn-sm" onClick={() => navigate(`/repos/${repoId}/branches`)}>
              All branches <ArrowRight size={12} />
            </button>
          </div>

          {localBranches.length === 0 ? (
            <div style={{ padding: '20px 16px', color: 'var(--text-muted)', fontSize: 13, textAlign: 'center' }}>
              No branches yet — <button className="btn btn-ghost btn-sm" onClick={() => navigate(`/repos/${repoId}/branches`)}><Plus size={12} /> Create one</button>
            </div>
          ) : (
            localBranches.slice(0, 5).map((b, i) => (
              <div key={b.id} onClick={() => navigate(`/repos/${repoId}/branches`)}
                style={{ padding: '9px 16px', borderBottom: i < Math.min(localBranches.length, 5) - 1 ? '1px solid var(--border-muted)' : 'none', display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}
                className="hover-row">
                <GitBranch size={13} color={b.name === repo.default_branch ? 'var(--accent-green)' : 'var(--text-muted)'} />
                <span style={{ flex: 1, fontSize: 13, fontWeight: b.name === repo.default_branch ? 600 : 400 }}>{b.name}</span>
                {b.name === repo.default_branch && <span className="badge badge-green" style={{ fontSize: 10 }}>current</span>}
                {b.last_commit_message && (
                  <span style={{ fontSize: 11, color: 'var(--text-muted)', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {b.last_commit_message}
                  </span>
                )}
              </div>
            ))
          )}

          {remoteBranches.length > 0 && (
            <div style={{ padding: '8px 16px', borderTop: '1px solid var(--border)', background: 'var(--bg-base)' }}>
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                <Globe size={11} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 4 }} />
                {remoteBranches.length} remote branch{remoteBranches.length !== 1 ? 'es' : ''}
              </span>
            </div>
          )}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 20 }}>

        {/* Recent commits */}
        <div className="card">
          <div className="card-header">
            <span style={{ fontWeight: 600, fontSize: 13 }}>
              <GitCommit size={13} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 6 }} />
              Recent Commits
              {commitsData?.total != null && (
                <span style={{ fontWeight: 400, color: 'var(--text-muted)', marginLeft: 6 }}>({commitsData.total} total)</span>
              )}
            </span>
            <button className="btn btn-ghost btn-sm" onClick={() => navigate(`/repos/${repoId}/commits`)}>
              Full history <ArrowRight size={12} />
            </button>
          </div>

          {commits.length === 0 ? (
            <div style={{ padding: '24px 16px', color: 'var(--text-muted)', fontSize: 13, textAlign: 'center' }}>
              No commits yet
              {!repo.is_initialized && (
                <div style={{ marginTop: 8 }}>
                  <button className="btn btn-ghost btn-sm" onClick={handleSync}>
                    <RefreshCw size={12} /> Sync from git
                  </button>
                </div>
              )}
            </div>
          ) : commits.map((c, i) => (
            <div key={c.id} onClick={() => navigate(`/repos/${repoId}/commits`)}
              style={{ padding: '10px 16px', borderBottom: i < commits.length - 1 ? '1px solid var(--border-muted)' : 'none', display: 'flex', alignItems: 'flex-start', gap: 12, cursor: 'pointer' }}
              className="hover-row">
              <code style={{ fontSize: 11, color: 'var(--accent-teal)', background: 'var(--bg-overlay)', padding: '2px 6px', borderRadius: 4, flexShrink: 0, marginTop: 1 }}>
                {c.short_hash}
              </code>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.message}</div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2, display: 'flex', gap: 10 }}>
                  {c.author_name && <span>{c.author_name}</span>}
                  <span><Clock size={10} style={{ display: 'inline', verticalAlign: 'middle' }} /> {timeAgo(c.committed_at)}</span>
                  {(c.files_changed > 0) && <span>{c.files_changed} file{c.files_changed !== 1 ? 's' : ''}</span>}
                  {c.insertions > 0 && <span style={{ color: 'var(--diff-add-text)' }}>+{c.insertions}</span>}
                  {c.deletions > 0 && <span style={{ color: 'var(--diff-del-text)' }}>−{c.deletions}</span>}
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Right column: remotes + working tree */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

          {/* Remotes */}
          <div className="card">
            <div className="card-header">
              <span style={{ fontWeight: 600, fontSize: 13 }}>
                <Globe size={13} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 6 }} />
                Remotes
              </span>
            </div>
            {(remotes as RemoteInfo[]).length === 0 ? (
              <div style={{ padding: '14px 16px', fontSize: 13, color: 'var(--text-muted)' }}>
                No remotes configured
                <div style={{ marginTop: 6 }}>
                  <button className="btn btn-ghost btn-sm" onClick={() => navigate(`/repos/${repoId}/advanced`)}>
                    <Plus size={12} /> Add remote
                  </button>
                </div>
              </div>
            ) : (remotes as RemoteInfo[]).map((r, i) => (
              <div key={i} style={{ padding: '10px 16px', borderBottom: i < (remotes as RemoteInfo[]).length - 1 ? '1px solid var(--border-muted)' : 'none' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--accent-blue)' }}>{r.name}</span>
                  {r.url && (
                    <a href={remoteWebURL(r.url)} target="_blank" rel="noreferrer"
                      style={{ color: 'var(--text-muted)', lineHeight: 0 }} title="Open in browser">
                      <ExternalLink size={11} />
                    </a>
                  )}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {r.url}
                </div>
                <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                  <button className="btn btn-ghost btn-sm" style={{ fontSize: 11, padding: '2px 8px' }}
                    onClick={() => navigate(`/repos/${repoId}/advanced`)}>
                    <Download size={11} /> Pull
                  </button>
                  <button className="btn btn-ghost btn-sm" style={{ fontSize: 11, padding: '2px 8px' }}
                    onClick={() => navigate(`/repos/${repoId}/advanced`)}>
                    <Upload size={11} /> Push
                  </button>
                </div>
              </div>
            ))}
          </div>

          {/* Working tree status */}
          <div className="card">
            <div className="card-header">
              <span style={{ fontWeight: 600, fontSize: 13 }}>
                <Folder size={13} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 6 }} />
                Working Tree
              </span>
              {changedFiles.length > 0 && (
                <button className="btn btn-primary btn-sm" style={{ fontSize: 11, padding: '2px 8px' }}
                  onClick={() => navigate(`/repos/${repoId}/commits`)}>
                  Stage &amp; Commit
                </button>
              )}
            </div>

            {changedFiles.length === 0 && untracked.length === 0 ? (
              <div style={{ padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--accent-green)' }}>
                <CheckCircle size={14} /> Clean — nothing to commit
              </div>
            ) : (
              <div>
                {[...changedFiles, ...untracked].slice(0, 8).map((f, i) => {
                  const modified = f.index !== ' ' && f.index !== '?' && f.index !== ''
                  const untrack = f.index === '?' || f.working === '?'
                  return (
                    <div key={i} style={{ padding: '7px 16px', borderBottom: '1px solid var(--border-muted)', display: 'flex', alignItems: 'center', gap: 8 }}>
                      {untrack
                        ? <Circle size={11} color="var(--text-muted)" />
                        : modified
                          ? <CheckCircle size={11} color="var(--accent-green)" />
                          : <AlertTriangle size={11} color="var(--accent-orange)" />}
                      <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: untrack ? 'var(--text-muted)' : 'var(--text-primary)' }}>
                        {f.path}
                      </span>
                      <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                        {untrack ? 'new' : modified ? 'staged' : 'modified'}
                      </span>
                    </div>
                  )
                })}
                {changedFiles.length + untracked.length > 8 && (
                  <div style={{ padding: '8px 16px', fontSize: 12, color: 'var(--text-muted)', textAlign: 'center' }}>
                    +{changedFiles.length + untracked.length - 8} more
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function remoteWebURL(url: string): string {
  if (url.startsWith('http')) return url.replace(/\.git$/, '')
  // git@github.com:user/repo.git → https://github.com/user/repo
  return url.replace(/\.git$/, '').replace(/^git@([^:]+):/, 'https://$1/')
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  if (d < 30) return `${d}d ago`
  return new Date(dateStr).toLocaleDateString()
}
