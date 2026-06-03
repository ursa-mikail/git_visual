import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { GitBranch, GitCommit, GitPullRequest, GitFork, Archive, AlertTriangle, ArrowRight, Clock, Plus } from 'lucide-react'
import { getRepos, getAudit } from '../utils/api'
import { Repository, PaginatedResult } from '../types'

interface AuditLog { id: string; action: string; details: string; repo_id?: string; created_at: string }

export default function DashboardPage() {
  const navigate = useNavigate()
  const { data: repos = [] } = useQuery<Repository[]>({ queryKey: ['repos'], queryFn: () => getRepos() })
  const { data: auditData } = useQuery<PaginatedResult<AuditLog>>({ queryKey: ['audit', 1], queryFn: () => getAudit(1, 10) })
  const audit: AuditLog[] = auditData?.data || []

  const features = [
    { icon: <GitBranch size={20} />, title: 'Branch Management', desc: 'Create, switch, rename, delete, and compare branches visually. No git checkout needed.', color: 'var(--accent-blue)' },
    { icon: <GitCommit size={20} />, title: 'Commit History', desc: 'Browse, search, filter commits. Stage files, write messages, revert — all visually.', color: 'var(--accent-green)' },
    { icon: <GitFork size={20} />, title: 'Diff & Conflict Resolution', desc: 'Side-by-side diff with drag-and-drop lines. 3-way conflict resolver with live preview.', color: 'var(--accent-orange)' },
    { icon: <GitMerge size={20} />, title: 'Merge & Rebase', desc: 'Guided merge with strategy selection. Interactive-style rebase, cherry-pick commits.', color: 'var(--accent-purple)' },
    { icon: <GitPullRequest size={20} />, title: 'Pull Requests', desc: 'Create PRs, assign reviewers, check conflicts, merge with one click.', color: 'var(--accent-teal)' },
    { icon: <Archive size={20} />, title: 'Stash & Tags', desc: 'Save work-in-progress, annotated tags, push tags to remote — visually guided.', color: 'var(--accent-yellow)' },
  ]

  return (
    <div style={{ padding: 24, maxWidth: 1200, margin: '0 auto' }}>
      {/* Hero */}
      <div style={{ textAlign: 'center', padding: '32px 0 40px', borderBottom: '1px solid var(--border)', marginBottom: 32 }}>
        <div style={{ fontSize: 40, marginBottom: 8 }}>🌿</div>
        <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 8, background: 'linear-gradient(135deg, var(--accent-blue), var(--accent-purple))', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
          Git Without Command Lines
        </h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: 15, maxWidth: 600, margin: '0 auto 24px' }}>
          Every git operation you've ever needed — branches, merges, rebases, cherry-picks, bisect, blame, submodules — all visual, all guided. You will never need a terminal again.
        </p>
        <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
          <button className="btn btn-primary" onClick={() => navigate('/repos')}>
            <Plus size={15} /> Add Repository
          </button>
          <button className="btn btn-ghost" onClick={() => navigate('/ssh')}>
            Set up GitHub Access
          </button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 24, marginBottom: 32 }}>
        {/* Stats */}
        <StatCard label="Repositories" value={(repos as Repository[]).length} icon={<GitFork size={18} />} color="var(--accent-blue)" onClick={() => navigate('/repos')} />
        <StatCard label="Recent Actions" value={audit.length} icon={<Clock size={18} />} color="var(--accent-purple)" onClick={() => navigate('/audit')} />
        <StatCard label="No Terminals Needed" value="100%" icon={<AlertTriangle size={18} />} color="var(--accent-green)" />
      </div>

      {/* Feature grid */}
      <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16, color: 'var(--text-secondary)' }}>Everything you need — visually guided</h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginBottom: 32 }}>
        {features.map(f => (
          <div key={f.title} className="card" style={{ padding: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
              <div style={{ padding: 8, borderRadius: 8, background: `${f.color}22`, color: f.color }}>{f.icon}</div>
              <h3 style={{ fontSize: 13, fontWeight: 600 }}>{f.title}</h3>
            </div>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.6 }}>{f.desc}</p>
          </div>
        ))}
      </div>

      {/* Repos list */}
      {(repos as Repository[]).length > 0 && (
        <div className="card">
          <div className="card-header">
            <h3 style={{ fontWeight: 600 }}>Your Repositories</h3>
            <button className="btn btn-ghost btn-sm" onClick={() => navigate('/repos')}>View all <ArrowRight size={13} /></button>
          </div>
          {(repos as Repository[]).slice(0, 5).map((repo: Repository) => (
            <div key={repo.id} onClick={() => navigate(`/repos/${repo.id}`)}
              style={{ padding: '12px 16px', borderBottom: '1px solid var(--border-muted)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ width: 32, height: 32, borderRadius: 6, background: 'var(--bg-overlay)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--accent-blue)' }}>
                <GitFork size={15} />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: 13 }}>{repo.name}</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{repo.description || repo.path}</div>
              </div>
              {repo.github_url && (
                <a href={repo.github_url} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()} style={{ color: 'var(--text-muted)', fontSize: 12 }}>
                  View on GitHub ↗
                </a>
              )}
              <span className={`badge ${repo.is_initialized ? 'badge-green' : 'badge-gray'}`}>
                {repo.is_initialized ? 'Active' : 'Pending'}
              </span>
              <ArrowRight size={14} color="var(--text-muted)" />
            </div>
          ))}
        </div>
      )}

      {/* Recent audit */}
      {audit.length > 0 && (
        <div className="card" style={{ marginTop: 24 }}>
          <div className="card-header">
            <h3 style={{ fontWeight: 600 }}>Recent Activity</h3>
            <button className="btn btn-ghost btn-sm" onClick={() => navigate('/audit')}>Full log</button>
          </div>
          {audit.slice(0, 5).map((a: AuditLog) => (
            <div key={a.id} style={{ padding: '8px 16px', borderBottom: '1px solid var(--border-muted)', display: 'flex', alignItems: 'center', gap: 10 }}>
              <span className="badge badge-blue">{a.action}</span>
              <span style={{ flex: 1, fontSize: 12, color: 'var(--text-secondary)' }}>{a.details}</span>
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{new Date(a.created_at).toLocaleString()}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function StatCard({ label, value, icon, color, onClick }: { label: string; value: unknown; icon: React.ReactNode; color: string; onClick?: () => void }) {
  return (
    <div className="card" style={{ padding: 20, cursor: onClick ? 'pointer' : 'default' }} onClick={onClick}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{label}</span>
        <div style={{ color, padding: 6, background: `${color}22`, borderRadius: 6 }}>{icon}</div>
      </div>
      <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--text-primary)' }}>{String(value)}</div>
    </div>
  )
}

// Missing import
function GitMerge({ size }: { size: number }) {
  return <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M6 21V9a9 9 0 0 0 9 9"/></svg>
}
