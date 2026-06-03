import { useState, useMemo } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { getDiff, getDiffDebug, getWorkingDiff, getRefs, getAllRefs, getCrossDiff } from '../utils/api'
import { DiffFile } from '../types'
import {
  Code, ChevronDown, ChevronRight, Eye, ArrowLeftRight, RefreshCw,
  GitBranch, GitFork, GitCommit, Tag, FolderOpen, Folder, File, Bug,
} from 'lucide-react'

interface RefInfo { label: string; ref: string; kind: string }
interface RefEntry { label: string; repo_id: string; ref: string; kind: string }

// ─── File-tree builder ────────────────────────────────────────────────────────
interface TreeNode {
  name: string
  path: string
  isDir: boolean
  children: TreeNode[]
  fileIndex?: number
}

function buildTree(files: DiffFile[]): TreeNode {
  const root: TreeNode = { name: '', path: '', isDir: true, children: [] }
  files.forEach((f, idx) => {
    const parts = f.path.split('/')
    let node = root
    parts.forEach((part, i) => {
      const isLast = i === parts.length - 1
      let child = node.children.find(c => c.name === part)
      if (!child) {
        child = { name: part, path: parts.slice(0, i + 1).join('/'), isDir: !isLast, children: [] }
        if (isLast) child.fileIndex = idx
        node.children.push(child)
      }
      node = child
    })
  })
  return root
}

function TreeNodeView({
  node, depth, selectedIdx, onSelect, openDirs, toggleDir,
}: {
  node: TreeNode; depth: number; selectedIdx: number | null
  onSelect: (i: number) => void
  openDirs: Set<string>; toggleDir: (p: string) => void
}) {
  if (node.isDir && node.name === '') {
    return <>{node.children.map(c => (
      <TreeNodeView key={c.path} node={c} depth={depth} selectedIdx={selectedIdx}
        onSelect={onSelect} openDirs={openDirs} toggleDir={toggleDir} />
    ))}</>
  }
  const open = openDirs.has(node.path)
  const indent = depth * 14
  if (node.isDir) {
    return (
      <div>
        <div onClick={() => toggleDir(node.path)}
          style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '3px 8px',
            paddingLeft: 8 + indent, cursor: 'pointer', fontSize: 12,
            color: 'var(--text-secondary)', userSelect: 'none' }}
          onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-hover)')}
          onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
          {open ? <FolderOpen size={13} color="var(--accent-blue)" /> : <Folder size={13} color="var(--text-muted)" />}
          <span>{node.name}</span>
        </div>
        {open && node.children.map(c => (
          <TreeNodeView key={c.path} node={c} depth={depth + 1} selectedIdx={selectedIdx}
            onSelect={onSelect} openDirs={openDirs} toggleDir={toggleDir} />
        ))}
      </div>
    )
  }
  const isSelected = node.fileIndex === selectedIdx
  return (
    <div onClick={() => node.fileIndex != null && onSelect(node.fileIndex)}
      style={{
        display: 'flex', alignItems: 'center', gap: 5, padding: '3px 8px',
        paddingLeft: 8 + indent, cursor: 'pointer', fontSize: 12,
        background: isSelected ? 'var(--accent-blue-dim, rgba(59,130,246,.15))' : 'transparent',
        color: isSelected ? 'var(--accent-blue)' : 'var(--text-primary)',
        userSelect: 'none',
      }}
      onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = 'var(--bg-hover)' }}
      onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background = 'transparent' }}>
      <File size={12} color="var(--text-muted)" />
      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{node.name}</span>
    </div>
  )
}

// ─── Ref picker helpers ───────────────────────────────────────────────────────
const kindIcon = (kind: string) => {
  if (kind === 'commit') return <GitCommit size={11} />
  if (kind === 'tag') return <Tag size={11} />
  return <GitBranch size={11} />
}

export default function DiffPage() {
  const { repoId } = useParams<{ repoId: string }>()
  const [searchParams] = useSearchParams()
  const [base, setBase]             = useState(searchParams.get('base') || '')
  const [compare, setCompare]       = useState(searchParams.get('branch') || '')
  const [baseRepoId, setBaseRepoId] = useState(repoId!)
  const [cmpRepoId, setCmpRepoId]   = useState(repoId!)
  const [working, setWorking]       = useState(false)
  const [crossMode, setCrossMode]   = useState(false)
  const [debugMode, setDebugMode]   = useState(false)

  // File explorer state
  const [selectedFileIdx, setSelectedFileIdx] = useState<number | null>(null)
  const [openDirs, setOpenDirs] = useState<Set<string>>(new Set())
  const toggleDir = (p: string) => setOpenDirs(s => { const n = new Set(s); n.has(p) ? n.delete(p) : n.add(p); return n })

  const { data: refs = [], isLoading: refsLoading, refetch } =
    useQuery<RefInfo[]>({ queryKey: ['refs', repoId], queryFn: () => getRefs(repoId!), staleTime: 15000 })

  const { data: allRefs = [], isLoading: allRefsLoading, refetch: refetchAll } =
    useQuery<RefEntry[]>({ queryKey: ['all-refs', repoId], queryFn: () => getAllRefs(repoId!), staleTime: 15000, enabled: crossMode })

  const { data: rawFiles = [], isLoading: diffLoading, error: diffError } =
    useQuery<DiffFile[]>({
      queryKey: ['diff', repoId, base, baseRepoId, compare, cmpRepoId, working, crossMode],
      queryFn: () => {
        if (working) return getWorkingDiff(repoId!)
        if (crossMode) return getCrossDiff(baseRepoId, base || undefined, compare || undefined, cmpRepoId !== baseRepoId ? cmpRepoId : undefined)
        return getDiff(repoId!, base || undefined, compare || undefined)
      },
      enabled: !!repoId && (working || !!(base || compare)),
      retry: false,
    })

  const { data: debugData, isLoading: debugLoading, refetch: refetchDebug } =
    useQuery({
      queryKey: ['diff-debug', repoId, base, compare],
      queryFn: () => getDiffDebug(repoId!, base || undefined, compare || undefined),
      enabled: debugMode && !!repoId && !!(base || compare) && !working,
      retry: false,
    })

  const files = rawFiles as DiffFile[]
  const totalAdd = files.reduce((s, f) => s + f.additions, 0)
  const totalDel = files.reduce((s, f) => s + f.deletions, 0)

  // Build file tree whenever files change; auto-expand top-level dirs
  const tree = useMemo(() => {
    const t = buildTree(files)
    setSelectedFileIdx(files.length > 0 ? 0 : null)
    const topDirs = new Set(t.children.filter(c => c.isDir).map(c => c.path))
    setOpenDirs(topDirs)
    return t
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [files.length, files.map(f => f.path).join('|')])

  const branches = (refs as RefInfo[]).filter(r => r.kind === 'branch')
  const tags     = (refs as RefInfo[]).filter(r => r.kind === 'tag')
  const commits  = (refs as RefInfo[]).filter(r => r.kind === 'commit')

  const local  = branches.filter(r => !r.ref.startsWith('origin/') && !r.ref.startsWith('remotes/'))
  const remote = branches.filter(r =>  r.ref.startsWith('origin/') ||  r.ref.startsWith('remotes/'))

  const ownRefs   = (allRefs as RefEntry[]).filter(r => r.repo_id === repoId)
  const otherRefs = (allRefs as RefEntry[]).filter(r => r.repo_id !== repoId)
  const otherRepos = [...new Set(otherRefs.map(r => r.repo_id))]

  const SimpleRefPicker = ({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) => (
    <select value={value} onChange={e => onChange(e.target.value)}
      style={{ minWidth: 200, fontFamily: 'var(--font-mono)', fontSize: 12 }}>
      <option value="">{placeholder}</option>
      {local.length  > 0 && <optgroup label="Local branches">{local.map(r =>  <option key={r.ref} value={r.ref}>{r.label}</option>)}</optgroup>}
      {remote.length > 0 && <optgroup label="Remote branches">{remote.map(r => <option key={r.ref} value={r.ref}>{r.label}</option>)}</optgroup>}
      {tags.length   > 0 && <optgroup label="Tags">{tags.map(r =>            <option key={r.ref} value={r.ref}>{r.label}</option>)}</optgroup>}
      {commits.length> 0 && <optgroup label="Commits">{commits.map(r =>      <option key={r.ref} value={r.ref}>{r.label}</option>)}</optgroup>}
    </select>
  )

  const CrossRefPicker = ({
    value, repoIdVal, onChangeRef, onChangeRepo, placeholder,
  }: { value: string; repoIdVal: string; onChangeRef: (v: string) => void; onChangeRepo: (v: string) => void; placeholder: string }) => (
    <select
      value={repoIdVal + '|' + value}
      onChange={e => { const [rid, ref] = e.target.value.split('|'); onChangeRepo(rid); onChangeRef(ref) }}
      style={{ minWidth: 230, fontFamily: 'var(--font-mono)', fontSize: 12 }}>
      <option value={repoId + '|'}>{placeholder}</option>
      {ownRefs.length > 0 && (
        <optgroup label="This repo">
          {ownRefs.map(r => <option key={r.label} value={r.repo_id + '|' + r.ref}>{kindIcon(r.kind)} {r.label}</option>)}
        </optgroup>
      )}
      {otherRepos.map(rid => {
        const rRefs = otherRefs.filter(r => r.repo_id === rid)
        if (!rRefs.length) return null
        const repoLabel = rRefs[0].label.split('/')[0]
        return (
          <optgroup key={rid} label={'📦 ' + repoLabel}>
            {rRefs.map(r => <option key={r.label} value={r.repo_id + '|' + r.ref}>{r.label}</option>)}
          </optgroup>
        )
      })}
    </select>
  )

  const isLoading = crossMode ? allRefsLoading : refsLoading
  const needsPicker = !working && !(base || compare)

  return (
    <div style={{ padding: 24, height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 4 }}>Diff Viewer</h1>
      <p style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 16 }}>
        Compare branches, tags, or commits — within or across repositories.
      </p>

      {/* Controls bar */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'center', flexWrap: 'wrap' }}>
        <button
          className={`btn btn-sm ${crossMode ? 'btn-primary' : 'btn-ghost'}`}
          onClick={() => { setCrossMode(c => !c); setBase(''); setCompare(''); setBaseRepoId(repoId!); setCmpRepoId(repoId!) }}
          title="Compare across repositories">
          <GitFork size={13} /> Cross-Repo
        </button>

        <div style={{ width: 1, height: 20, background: 'var(--border)' }} />

        {crossMode ? (
          <>
            <CrossRefPicker value={base} repoIdVal={baseRepoId} onChangeRef={setBase} onChangeRepo={setBaseRepoId} placeholder="Base (repo / ref)…" />
            <button className="btn btn-ghost btn-icon" title="Swap" onClick={() => { setBase(compare); setCompare(base); setBaseRepoId(cmpRepoId); setCmpRepoId(baseRepoId) }}>
              <ArrowLeftRight size={14} />
            </button>
            <CrossRefPicker value={compare} repoIdVal={cmpRepoId} onChangeRef={setCompare} onChangeRepo={setCmpRepoId} placeholder="Compare (repo / ref)…" />
            <button className="btn btn-ghost btn-icon" title="Refresh" onClick={() => refetchAll()} disabled={allRefsLoading}>
              <RefreshCw size={13} className={allRefsLoading ? 'spin' : ''} />
            </button>
          </>
        ) : (
          <>
            <SimpleRefPicker value={base}    onChange={setBase}    placeholder="Base (branch / commit)…" />
            <button className="btn btn-ghost btn-icon" title="Swap" onClick={() => { setBase(compare); setCompare(base) }}>
              <ArrowLeftRight size={14} />
            </button>
            <SimpleRefPicker value={compare} onChange={setCompare} placeholder="Compare (branch / commit)…" />
            <button className={`btn btn-sm ${working ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setWorking(w => !w)}>
              <Eye size={13} /> Working Tree
            </button>
            <button className="btn btn-ghost btn-icon" title="Refresh" onClick={() => refetch()} disabled={refsLoading}>
              <RefreshCw size={13} className={refsLoading ? 'spin' : ''} />
            </button>
            <button
              className={`btn btn-sm ${debugMode ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => { setDebugMode(d => !d); if (!debugMode) refetchDebug() }}
              title="Show raw git diff debug info">
              <Bug size={13} /> Debug
            </button>
          </>
        )}

        {(totalAdd > 0 || totalDel > 0) && (
          <span style={{ marginLeft: 'auto', fontSize: 13 }}>
            <span style={{ color: 'var(--diff-add-text)' }}>+{totalAdd}</span>
            {' / '}
            <span style={{ color: 'var(--accent-red-hover)' }}>-{totalDel}</span>
            {' in '}{files.length} file(s)
          </span>
        )}
      </div>

      {!isLoading && !crossMode && refs.length === 0 && (
        <div className="guide-tip" style={{ marginBottom: 16 }}>
          <GitBranch size={15} />
          <span>No branches found. Go to the repo overview and click <strong>Sync</strong> first.</span>
        </div>
      )}

      {/* Main content */}
      {diffLoading ? (
        <div className="loading"><div className="spinner" /> Computing diff…</div>
      ) : diffError ? (
        <div className="empty-state" style={{ color: 'var(--accent-red-hover)' }}>
          <Code size={40} /><p>{(diffError as Error).message}</p>
        </div>
      ) : needsPicker ? (
        <div className="empty-state">
          <Code size={48} />
          <p style={{ textAlign: 'center' }}>
            Pick a base and/or compare ref above.<br/>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              Branches, remote refs, tags, and commits are all supported.
              Selecting one commit shows what it introduced.
            </span>
          </p>
        </div>
      ) : files.length === 0 ? (
        <div className="empty-state">
          <Code size={48} />
          <p style={{ textAlign: 'center' }}>No differences between these refs</p>
        </div>
      ) : (
        <>
          {/* Debug panel */}
          {debugMode && (
            <div style={{ marginBottom: 16, padding: 12, background: 'var(--bg-elevated)', borderRadius: 8, border: '1px solid var(--border)', fontSize: 12 }}>
              <div style={{ fontWeight: 700, marginBottom: 8, color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 6 }}>
                <Bug size={13} /> Git Diff Debug
                <button className="btn btn-ghost btn-sm" style={{ marginLeft: 'auto' }} onClick={() => refetchDebug()} disabled={debugLoading}>
                  {debugLoading ? 'Loading…' : 'Re-run'}
                </button>
              </div>
              {debugData && (
                <pre style={{ overflow: 'auto', maxHeight: 300, fontSize: 11, color: 'var(--text-muted)', margin: 0, whiteSpace: 'pre-wrap' }}>
                  {JSON.stringify(debugData, null, 2)}
                </pre>
              )}
            </div>
          )}
          {/* Two-panel layout: file explorer left, diff right */}
          <div style={{ display: 'flex', gap: 0, flex: 1, overflow: 'hidden', border: '1px solid var(--border)', borderRadius: 8 }}>

          {/* File explorer panel */}
          <div style={{
            width: 240, flexShrink: 0, borderRight: '1px solid var(--border)',
            background: 'var(--bg-elevated)', overflowY: 'auto', padding: '8px 0',
          }}>
            <div style={{ padding: '4px 12px 8px', fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.05em', textTransform: 'uppercase' }}>
              Changed Files
            </div>
            <TreeNodeView
              node={tree}
              depth={0}
              selectedIdx={selectedFileIdx}
              onSelect={setSelectedFileIdx}
              openDirs={openDirs}
              toggleDir={toggleDir}
            />
          </div>

          {/* Diff panel */}
          <div style={{ flex: 1, overflowY: 'auto' }}>
            {selectedFileIdx != null && files[selectedFileIdx] ? (
              <div>
                {/* File header */}
                <div style={{
                  padding: '8px 14px', background: 'var(--bg-surface)',
                  borderBottom: '1px solid var(--border)',
                  display: 'flex', alignItems: 'center', gap: 10, position: 'sticky', top: 0, zIndex: 2,
                }}>
                  <Code size={14} color="var(--text-muted)" />
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, flex: 1 }}>
                    {files[selectedFileIdx].path}
                  </span>
                  <span style={{ color: 'var(--diff-add-text)', fontSize: 12 }}>+{files[selectedFileIdx].additions}</span>
                  <span style={{ color: 'var(--accent-red-hover)', fontSize: 12, marginLeft: 4 }}>-{files[selectedFileIdx].deletions}</span>
                  {files[selectedFileIdx].is_binary && <span className="badge badge-yellow">binary</span>}
                  {/* Prev/next file navigation */}
                  <button className="btn btn-ghost btn-sm" disabled={selectedFileIdx === 0}
                    onClick={() => setSelectedFileIdx(i => (i ?? 1) - 1)} title="Previous file">‹</button>
                  <button className="btn btn-ghost btn-sm" disabled={selectedFileIdx === files.length - 1}
                    onClick={() => setSelectedFileIdx(i => (i ?? 0) + 1)} title="Next file">›</button>
                </div>
                {!files[selectedFileIdx].is_binary && <SideBySide file={files[selectedFileIdx]} />}
                {files[selectedFileIdx].is_binary && (
                  <div className="empty-state" style={{ padding: 40 }}>
                    <File size={32} /><p>Binary file — no diff available</p>
                  </div>
                )}
              </div>
            ) : (
              <div className="empty-state" style={{ padding: 40 }}>
                <File size={32} /><p>Select a file on the left</p>
              </div>
            )}
          </div>
          </div>
        </>
      )}
    </div>
  )
}

function SideBySide({ file }: { file: DiffFile }) {
  type Row = { content: string; type: string; num: number | null }
  const L: Row[] = [], R: Row[] = []
  let lo = 0, ro = 0
  for (const line of file.lines) {
    if (line.type === 'header') {
      L.push({ content: line.content, type: 'header', num: null })
      R.push({ content: line.content, type: 'header', num: null })
    } else if (line.type === 'removed') {
      L.push({ content: line.content, type: 'removed', num: line.line_num_old ?? ++lo })
      R.push({ content: '', type: 'empty', num: null })
    } else if (line.type === 'added') {
      L.push({ content: '', type: 'empty', num: null })
      R.push({ content: line.content, type: 'added', num: line.line_num_new ?? ++ro })
    } else {
      L.push({ content: line.content, type: 'context', num: line.line_num_old ?? ++lo })
      R.push({ content: line.content, type: 'context', num: line.line_num_new ?? ++ro })
    }
  }

  const bg = (t: string) => t === 'removed' ? 'var(--diff-remove-bg)' : t === 'added' ? 'var(--diff-add-bg)' : t === 'header' ? 'var(--diff-header-bg)' : 'transparent'
  const fg = (t: string) => t === 'removed' ? 'var(--diff-remove-text)' : t === 'added' ? 'var(--diff-add-text)' : t === 'header' ? 'var(--text-muted)' : 'var(--text-primary)'

  const Panel = ({ rows, label, stat }: { rows: Row[]; label: string; stat: React.ReactNode }) => (
    <div style={{ overflow: 'auto', borderRight: label === 'L' ? '1px solid var(--border)' : undefined }}>
      <div style={{ padding: '3px 8px', background: 'var(--bg-elevated)', fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, borderBottom: '1px solid var(--border)', display: 'flex', gap: 8, position: 'sticky', top: 0 }}>
        <span>{label === 'L' ? (file.old_path || file.path) : file.path}</span>{stat}
      </div>
      {rows.map((row, i) => (
        <div key={i} style={{ display: 'flex', fontFamily: 'var(--font-mono)', fontSize: 12, minHeight: 20, background: bg(row.type) }}>
          <span style={{ minWidth: 40, padding: '0 6px', textAlign: 'right', color: 'var(--text-muted)', borderRight: '1px solid var(--border-muted)', fontSize: 11, userSelect: 'none', flexShrink: 0 }}>
            {row.num ?? ''}
          </span>
          <span style={{ padding: '0 8px', flex: 1, whiteSpace: 'pre', color: fg(row.type), overflow: 'hidden' }}>
            {row.type === 'removed' && <span style={{ opacity: 0.5, userSelect: 'none' }}>- </span>}
            {row.type === 'added'   && <span style={{ opacity: 0.5, userSelect: 'none' }}>+ </span>}
            {row.content}
          </span>
        </div>
      ))}
    </div>
  )

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', borderTop: '1px solid var(--border)' }}>
      <Panel rows={L} label="L" stat={<span style={{ color: 'var(--accent-red-hover)' }}>-{file.deletions}</span>} />
      <Panel rows={R} label="R" stat={<span style={{ color: 'var(--diff-add-text)' }}>+{file.additions}</span>} />
    </div>
  )
}
