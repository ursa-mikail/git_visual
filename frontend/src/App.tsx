import { useState, useEffect, useRef } from 'react'
import { Routes, Route, NavLink, useNavigate, useParams, useLocation } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Toaster, toast } from 'react-hot-toast'
import {
  GitBranch, GitCommit, GitMerge, GitPullRequest, Search,
  Settings, Database, FileText, Key, History, Tag, Archive,
  GitFork, AlertTriangle, ChevronRight, ChevronDown, Home,
  Play, RotateCcw, Upload, Download, Layers, Eye, Zap,
  RefreshCw, Terminal, User, Star, X, ExternalLink, LayoutGrid
} from 'lucide-react'
import { getRepos, search as apiSearch } from './utils/api'
import { Repository, SearchResult } from './types'

// Pages
import DashboardPage from './pages/DashboardPage'
import RepositoriesPage from './pages/RepositoriesPage'
import RepoOverviewPage from './pages/RepoOverviewPage'
import BranchesPage from './pages/BranchesPage'
import CommitsPage from './pages/CommitsPage'
import DiffPage from './pages/DiffPage'
import MergePage from './pages/MergePage'
import PullRequestsPage from './pages/PullRequestsPage'
import StashTagsPage from './pages/StashTagsPage'
import AdvancedOpsPage from './pages/AdvancedOpsPage'
import ConflictsPage from './pages/ConflictsPage'
import BlamePage from './pages/BlamePage'
import SchemaPage from './pages/SchemaPage'
import AuditPage from './pages/AuditPage'
import SSHPage from './pages/SSHPage'
import SettingsPage from './pages/SettingsPage'

interface NavItem {
  to: string; icon: React.ReactNode; label: string; badge?: string; tip?: string
}

function GlobalSearch() {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [results, setResults] = useState<SearchResult[]>([])
  const debounce = useRef<ReturnType<typeof setTimeout>>()
  const navigate = useNavigate()

  useEffect(() => {
    clearTimeout(debounce.current)
    if (q.length < 2) { setResults([]); setOpen(false); return }
    debounce.current = setTimeout(async () => {
      try {
        const data = await apiSearch(q)
        setResults(data)
        setOpen(true)
      } catch {}
    }, 250)
    return () => clearTimeout(debounce.current)
  }, [q])

  const go = (r: SearchResult) => {
    setQ(''); setOpen(false)
    if (r.type === 'repository') navigate(`/repos/${r.id}`)
    else if (r.type === 'commit') navigate(`/repos/${r.repo_id}/commits`)
    else if (r.type === 'branch') navigate(`/repos/${r.repo_id}/branches`)
  }

  return (
    <div style={{ position: 'relative', flex: 1, maxWidth: 400 }}>
      <div style={{ position: 'relative' }}>
        <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }} />
        <input
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder="Search repos, commits, branches…"
          style={{ width: '100%', paddingLeft: 32, paddingRight: 10 }}
          onFocus={() => q.length >= 2 && setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 200)}
        />
      </div>
      {open && q.length >= 2 && (
        <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 200, background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', marginTop: 4, boxShadow: 'var(--shadow-lg)', overflow: 'hidden' }}>
          {results.length > 0 && results.map(r => (
            <div key={r.id} onMouseDown={() => go(r)} style={{ padding: '8px 12px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10, borderBottom: '1px solid var(--border-muted)' }}
              className="hover-row">
              <span className={`badge badge-${r.type === 'repository' ? 'blue' : r.type === 'commit' ? 'green' : 'purple'}`}>{r.type}</span>
              <div>
                <div style={{ fontSize: 13 }}>{r.title}</div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{r.subtitle} · {r.repo_name}</div>
              </div>
              {r.url && <a href={r.url} target="_blank" rel="noreferrer" style={{ marginLeft: 'auto' }}><ExternalLink size={12} /></a>}
            </div>
          ))}
          {/* Remote search links — always shown when query is long enough */}
          <div style={{ borderTop: results.length > 0 ? '1px solid var(--border)' : 'none', background: 'var(--bg-base)' }}>
            <div style={{ padding: '5px 12px 3px', fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5 }}>
              Search remotely
            </div>
            {[
              { label: 'GitHub', icon: '🐙', url: `https://github.com/search?q=${encodeURIComponent(q)}&type=repositories` },
              { label: 'GitLab', icon: '🦊', url: `https://gitlab.com/search?search=${encodeURIComponent(q)}&scope=projects` },
            ].map(remote => (
              <a
                key={remote.label}
                href={remote.url}
                target="_blank"
                rel="noreferrer"
                onMouseDown={e => e.preventDefault()}
                style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 12px', fontSize: 13, color: 'var(--text-secondary)', textDecoration: 'none', borderBottom: '1px solid var(--border-muted)' }}
                className="hover-row"
              >
                <span>{remote.icon}</span>
                <span>Search <strong>"{q}"</strong> on {remote.label}</span>
                <ExternalLink size={11} style={{ marginLeft: 'auto', color: 'var(--text-muted)' }} />
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function RepoSelector() {
  const { repoId } = useParams<{ repoId?: string }>()
  const navigate = useNavigate()
  const { data: repos = [] } = useQuery({ queryKey: ['repos'], queryFn: () => getRepos() })

  return (
    <select
      value={repoId || ''}
      onChange={e => { if (e.target.value) navigate(`/repos/${e.target.value}/branches`) }}
      style={{ maxWidth: 200 }}
    >
      <option value="">— switch repo —</option>
      {(repos as Repository[]).map((r: Repository) => (
        <option key={r.id} value={r.id}>{r.name}</option>
      ))}
    </select>
  )
}

export default function App() {
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [repoExpanded, setRepoExpanded] = useState(true)
  const location = useLocation()
  const { repoId } = useParams<{ repoId?: string }>()
  
  // Extract repoId from path
  const pathRepoId = location.pathname.match(/\/repos\/([^/]+)/)?.[1]

  useEffect(() => {
    // SSE for real-time updates
    const es = new EventSource('/api/events')
    es.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data)
        if (msg.event === 'repo.synced') {
          toast.success('✓ Repository synced — branches & commits loaded', { duration: 3000, position: 'bottom-right' })
        } else if (msg.event === 'repo.clone_failed') {
          const errMsg = msg.data?.error || 'unknown error'
          toast.error(`Clone failed: ${errMsg}`, { duration: 8000, position: 'bottom-right' })
        } else if (msg.event === 'repo.created') {
          // no toast — the submit handler already shows one
        } else if (msg.event?.startsWith('repo.')) {
          toast.success(`✓ ${msg.event.replace('.', ' ')}`, { duration: 2000, position: 'bottom-right' })
        }
      } catch {}
    }
    return () => es.close()
  }, [])

  const repoNavItems: NavItem[] = pathRepoId ? [
    { to: `/repos/${pathRepoId}`, icon: <LayoutGrid size={15} />, label: 'Overview', tip: 'Commits, branches, remotes at a glance' },
    { to: `/repos/${pathRepoId}/branches`, icon: <GitBranch size={15} />, label: 'Branches', tip: 'Create, switch, delete, rename branches' },
    { to: `/repos/${pathRepoId}/commits`, icon: <GitCommit size={15} />, label: 'Commits', tip: 'Browse history, revert, cherry-pick' },
    { to: `/repos/${pathRepoId}/diff`, icon: <FileText size={15} />, label: 'Diff Viewer', tip: 'Side-by-side diff with drag & drop' },
    { to: `/repos/${pathRepoId}/merge`, icon: <GitMerge size={15} />, label: 'Merge / Rebase', tip: 'Merge, rebase, resolve conflicts' },
    { to: `/repos/${pathRepoId}/conflicts`, icon: <AlertTriangle size={15} />, label: 'Conflict Resolver', tip: 'Visual 3-way conflict resolution' },
    { to: `/repos/${pathRepoId}/prs`, icon: <GitPullRequest size={15} />, label: 'Pull Requests', tip: 'Create and review PRs' },
    { to: `/repos/${pathRepoId}/stash-tags`, icon: <Archive size={15} />, label: 'Stash & Tags', tip: 'Manage stashes and version tags' },
    { to: `/repos/${pathRepoId}/advanced`, icon: <Zap size={15} />, label: 'Advanced Ops', tip: 'Push, pull, fetch, reset, bisect, blame, submodules' },
    { to: `/repos/${pathRepoId}/blame`, icon: <Eye size={15} />, label: 'Blame', tip: 'See who changed each line' },
  ] : []

  const globalNavItems: NavItem[] = [
    { to: '/', icon: <Home size={15} />, label: 'Dashboard' },
    { to: '/repos', icon: <GitFork size={15} />, label: 'Repositories' },
    { to: '/schema', icon: <Database size={15} />, label: 'DB Explorer' },
    { to: '/audit', icon: <History size={15} />, label: 'Audit Log' },
    { to: '/ssh', icon: <Key size={15} />, label: 'SSH & Auth' },
    { to: '/settings', icon: <Settings size={15} />, label: 'Settings' },
  ]

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
      {/* Sidebar */}
      <aside style={{
        width: sidebarOpen ? 220 : 48,
        background: 'var(--bg-surface)',
        borderRight: '1px solid var(--border)',
        display: 'flex',
        flexDirection: 'column',
        transition: 'width 200ms ease',
        overflow: 'hidden',
        flexShrink: 0,
      }}>
        {/* Logo */}
        <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}
          onClick={() => setSidebarOpen(s => !s)}>
          <div style={{ width: 28, height: 28, borderRadius: 6, background: 'linear-gradient(135deg, var(--accent-blue), var(--accent-purple))', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <GitBranch size={16} color="#fff" />
          </div>
          {sidebarOpen && <span style={{ fontWeight: 700, fontSize: 14, color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>GitVisual</span>}
        </div>

        {/* Nav content */}
        <nav style={{ flex: 1, overflow: 'auto', padding: '8px 0' }}>
          {/* Global nav */}
          <div style={{ padding: sidebarOpen ? '4px 8px 2px' : '4px 0 2px', fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1, textAlign: sidebarOpen ? 'left' : 'center' }}>
            {sidebarOpen ? 'Navigation' : '···'}
          </div>
          {globalNavItems.map(item => (
            <NavLink key={item.to} to={item.to} end={item.to === '/'}
              style={({ isActive }) => ({
                display: 'flex', alignItems: 'center', gap: 10, padding: '7px 14px',
                color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)',
                background: isActive ? 'var(--bg-hover)' : 'transparent',
                borderLeft: isActive ? '2px solid var(--accent-blue)' : '2px solid transparent',
                fontSize: 13, textDecoration: 'none', transition: 'all var(--transition)',
                whiteSpace: 'nowrap', overflow: 'hidden',
              })}>
              <span style={{ flexShrink: 0 }}>{item.icon}</span>
              {sidebarOpen && <span>{item.label}</span>}
            </NavLink>
          ))}

          {/* Repo-specific nav */}
          {pathRepoId && sidebarOpen && (
            <>
              <div style={{ padding: '10px 14px 2px', fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1, display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' }}
                onClick={() => setRepoExpanded(e => !e)}>
                <span>Repository</span>
                {repoExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              </div>
              {repoExpanded && repoNavItems.map(item => (
                <NavLink key={item.to} to={item.to}
                  style={({ isActive }) => ({
                    display: 'flex', alignItems: 'center', gap: 10, padding: '7px 14px 7px 20px',
                    color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)',
                    background: isActive ? 'var(--bg-hover)' : 'transparent',
                    borderLeft: isActive ? '2px solid var(--accent-blue)' : '2px solid transparent',
                    fontSize: 13, textDecoration: 'none', transition: 'all var(--transition)',
                    whiteSpace: 'nowrap', overflow: 'hidden',
                  })}>
                  <span style={{ flexShrink: 0 }}>{item.icon}</span>
                  {sidebarOpen && (
                    <span className="tooltip">
                      {item.label}
                      {item.tip && <span className="tooltip-text">{item.tip}</span>}
                    </span>
                  )}
                </NavLink>
              ))}
            </>
          )}
        </nav>

        {/* Bottom user area */}
        {sidebarOpen && (
          <div style={{ padding: '10px 14px', borderTop: '1px solid var(--border)', fontSize: 12, color: 'var(--text-muted)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div className="status-dot green" />
              <span>No cmd line needed</span>
            </div>
          </div>
        )}
      </aside>

      {/* Main area */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* Top bar */}
        <header style={{ height: 48, borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 12, padding: '0 16px', background: 'var(--bg-surface)', flexShrink: 0 }}>
          <GlobalSearch />
          {pathRepoId && <RepoSelector />}
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>GitVisual v2</span>
          </div>
        </header>

        {/* Page content */}
        <main style={{ flex: 1, overflow: 'auto' }}>
          <Routes>
            <Route path="/" element={<DashboardPage />} />
            <Route path="/repos" element={<RepositoriesPage />} />
            <Route path="/repos/:repoId" element={<RepoOverviewPage />} />
            <Route path="/repos/:repoId/branches" element={<BranchesPage />} />
            <Route path="/repos/:repoId/commits" element={<CommitsPage />} />
            <Route path="/repos/:repoId/diff" element={<DiffPage />} />
            <Route path="/repos/:repoId/merge" element={<MergePage />} />
            <Route path="/repos/:repoId/conflicts" element={<ConflictsPage />} />
            <Route path="/repos/:repoId/prs" element={<PullRequestsPage />} />
            <Route path="/repos/:repoId/stash-tags" element={<StashTagsPage />} />
            <Route path="/repos/:repoId/advanced" element={<AdvancedOpsPage />} />
            <Route path="/repos/:repoId/blame" element={<BlamePage />} />
            <Route path="/schema" element={<SchemaPage />} />
            <Route path="/audit" element={<AuditPage />} />
            <Route path="/ssh" element={<SSHPage />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Routes>
        </main>
      </div>

      <Toaster position="bottom-right" toastOptions={{
        style: { background: 'var(--bg-elevated)', color: 'var(--text-primary)', border: '1px solid var(--border)' }
      }} />
    </div>
  )
}
