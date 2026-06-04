import { useState, useMemo, useEffect, useRef } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  getDiff, getDiffDebug, getWorkingDiff, getRefs, getAllRefs,
  getCrossDiff, getRefTree, getCrossRefTree, getFilePairDiff,
} from '../utils/api'
import { DiffFile } from '../types'
import {
  Code, Eye, ArrowLeftRight, RefreshCw,
  GitBranch, GitFork, FolderOpen, Folder, File, Bug,
  FileDiff, FilePlus, FileMinus, FileX,
} from 'lucide-react'

// ─── Types ────────────────────────────────────────────────────────────────────
interface RefInfo  { label: string; ref: string; kind: string }
interface RefEntry { label: string; repo_id: string; ref: string; kind: string }
interface FileEntry { path: string }
type DiffStatus = 'added' | 'removed' | 'modified' | 'renamed'

interface FNode {
  name: string; path: string; isDir: boolean; children: FNode[]
  diffStatus?: DiffStatus | null; diffIndex?: number
}
interface PickerOption {
  label: string; ref: string; repoId: string; repoName: string; kind: string
}

// ─── Tree helpers ─────────────────────────────────────────────────────────────
function buildFileTree(paths: string[], statusMap: Map<string, { status: DiffStatus; index: number }>): FNode {
  const root: FNode = { name: '', path: '', isDir: true, children: [] }
  for (const fp of paths) {
    const parts = fp.split('/')
    let node = root
    for (let i = 0; i < parts.length; i++) {
      const isLast = i === parts.length - 1
      const np = parts.slice(0, i + 1).join('/')
      let child = node.children.find(c => c.name === parts[i])
      if (!child) {
        const info = isLast ? statusMap.get(fp) : undefined
        child = { name: parts[i], path: np, isDir: !isLast, children: [],
          diffStatus: info?.status ?? null, diffIndex: info?.index }
        node.children.push(child)
      }
      node = child
    }
  }
  return root
}

function hasDiffDescendant(n: FNode): boolean {
  return n.children.some(c => c.isDir ? hasDiffDescendant(c) : !!c.diffStatus)
}
function containsFileIdx(n: FNode, idx: number | null): boolean {
  if (idx == null) return false
  return n.children.some(c => c.isDir ? containsFileIdx(c, idx) : c.diffIndex === idx)
}

// ─── Status icons ─────────────────────────────────────────────────────────────
const S_ICON: Record<DiffStatus, React.ReactNode> = {
  added:    <FilePlus  size={11} color="var(--diff-add-text)" />,
  removed:  <FileMinus size={11} color="var(--accent-red-hover)" />,
  modified: <FileDiff  size={11} color="#f59e0b" />,
  renamed:  <FileDiff  size={11} color="#a78bfa" />,
}
const S_COLOR: Record<DiffStatus, string> = {
  added: 'var(--diff-add-text)', removed: 'var(--accent-red-hover)',
  modified: '#f59e0b', renamed: '#a78bfa',
}

// ─── File tree node ───────────────────────────────────────────────────────────
// selectedPath: the independently-chosen path for this side
// onSelectPath: called when any file (including unchanged) is clicked
// selIdx:       the "git diff entry" selection (null in independent mode)
function FileTreeNode({ node, depth, selIdx, openDirs, toggleDir, selectedPath, onSelectPath }: {
  node: FNode; depth: number; selIdx: number | null
  openDirs: Set<string>; toggleDir: (p: string) => void
  selectedPath?: string | null
  onSelectPath: (path: string) => void
}) {
  if (node.isDir && !node.name) {
    return (
      <>{node.children.map(c =>
        <FileTreeNode key={c.path} node={c} depth={depth} selIdx={selIdx}
          openDirs={openDirs} toggleDir={toggleDir}
          selectedPath={selectedPath} onSelectPath={onSelectPath} />
      )}</>
    )
  }

  const indent = depth * 12

  if (node.isDir) {
    const isOpen = openDirs.has(node.path)
    const active = containsFileIdx(node, selIdx)
    const hasChg = hasDiffDescendant(node)
    return (
      <div>
        <div onClick={() => toggleDir(node.path)} style={{
          display: 'flex', alignItems: 'center', gap: 4,
          padding: '2px 6px', paddingLeft: 4 + indent,
          cursor: 'pointer', userSelect: 'none', fontSize: 11,
          color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
          fontWeight: active ? 600 : 400,
        }}
          onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-hover)')}
          onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
          {isOpen
            ? <FolderOpen size={12} color="var(--accent-blue)" />
            : <Folder    size={12} color={hasChg ? '#f59e0b' : 'var(--text-muted)'} />}
          <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {node.name}
          </span>
        </div>
        {isOpen && node.children.map(c =>
          <FileTreeNode key={c.path} node={c} depth={depth + 1} selIdx={selIdx}
            openDirs={openDirs} toggleDir={toggleDir}
            selectedPath={selectedPath} onSelectPath={onSelectPath} />
        )}
      </div>
    )
  }

  // File leaf
  const isPathSel = selectedPath === node.path
  const isDiffSel = node.diffIndex === selIdx && selIdx != null
  const hasDiff   = !!node.diffStatus

  const bg = isPathSel
    ? 'rgba(59,130,246,.18)'
    : isDiffSel ? 'rgba(59,130,246,.09)' : 'transparent'
  const color = isPathSel
    ? 'var(--accent-blue)'
    : isDiffSel
      ? (node.diffStatus ? S_COLOR[node.diffStatus] : 'var(--accent-blue)')
      : hasDiff ? S_COLOR[node.diffStatus!] : 'var(--text-muted)'

  return (
    <div onClick={() => onSelectPath(node.path)} style={{
      display: 'flex', alignItems: 'center', gap: 4,
      padding: '2px 6px', paddingLeft: 4 + indent,
      cursor: 'pointer', userSelect: 'none', fontSize: 11,
      background: bg, color,
      opacity: 1,  // all files clickable, never dimmed out
      outline: isPathSel ? '1px solid rgba(59,130,246,.4)' : undefined,
    }}
      onMouseEnter={e => { if (!isPathSel && !isDiffSel) e.currentTarget.style.background = 'var(--bg-hover)' }}
      onMouseLeave={e => { if (!isPathSel && !isDiffSel) e.currentTarget.style.background = 'transparent' }}>
      {node.diffStatus ? S_ICON[node.diffStatus] : <File size={11} color={isPathSel ? 'var(--accent-blue)' : 'var(--text-muted)'} />}
      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        fontWeight: hasDiff || isPathSel ? 500 : 400 }}>
        {node.name}
      </span>
    </div>
  )
}

// ─── Ref Picker ───────────────────────────────────────────────────────────────
function RefPicker({ options, value, repoIdVal, onSelect, placeholder, accentColor }: {
  options: PickerOption[]
  value: string; repoIdVal: string
  onSelect: (ref: string, repoId: string) => void
  placeholder: string; accentColor: string
}) {
  const [open,  setOpen]  = useState(false)
  const [query, setQuery] = useState('')
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const q = query.toLowerCase()
  const filtered = q
    ? options.filter(o =>
        o.label.toLowerCase().includes(q) ||
        o.ref.toLowerCase().includes(q) ||
        o.repoName.toLowerCase().includes(q))
    : options

  type Group = { key: string; repoName: string; kind: string; items: PickerOption[] }
  const groups: Group[] = []
  for (const o of filtered) {
    const key = o.repoId + '/' + o.kind
    let g = groups.find(g => g.key === key)
    if (!g) { g = { key, repoName: o.repoName, kind: o.kind, items: [] }; groups.push(g) }
    g.items.push(o)
  }

  const selected = options.find(o => o.ref === value && o.repoId === repoIdVal)
  const repoPrefix = selected && selected.repoName !== 'this' ? selected.repoName + '/' : ''
  const cleanLabel = selected
    ? (selected.label.startsWith(repoPrefix) ? selected.label.slice(repoPrefix.length) : selected.label)
    : ''
  const displayLabel = selected
    ? (selected.repoName !== 'this' ? selected.repoName + ' / ' : '') + cleanLabel
    : placeholder

  const KIND_LABEL: Record<string, string> = { branch: 'Branches', tag: 'Tags', commit: 'Commits' }
  const KIND_ORDER = ['branch', 'tag', 'commit']

  return (
    <div ref={wrapRef} style={{ position: 'relative', display: 'inline-block', minWidth: 240 }}>
      <button onClick={() => { setOpen(o => !o); setQuery('') }} style={{
        width: '100%', textAlign: 'left', padding: '4px 10px',
        background: 'var(--bg-surface)', border: '1px solid var(--border)',
        borderRadius: 6, cursor: 'pointer', fontSize: 12, fontFamily: 'var(--font-mono)',
        color: selected ? accentColor : 'var(--text-muted)',
        display: 'flex', alignItems: 'center', gap: 6,
      }}>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
          {displayLabel}
        </span>
        <span style={{ color: 'var(--text-muted)', fontSize: 10, flexShrink: 0 }}>▾</span>
      </button>

      {open && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, zIndex: 200,
          width: 360, maxHeight: 420, overflow: 'hidden',
          background: 'var(--bg-elevated)', border: '1px solid var(--border)',
          borderRadius: 8, boxShadow: '0 8px 32px rgba(0,0,0,.5)',
          display: 'flex', flexDirection: 'column', marginTop: 4,
        }}>
          <div style={{ padding: '6px 8px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
            <input autoFocus value={query} onChange={e => setQuery(e.target.value)}
              placeholder="Search branch, tag, commit…"
              style={{
                width: '100%', padding: '4px 8px', fontSize: 12, boxSizing: 'border-box',
                background: 'var(--bg-surface)', border: '1px solid var(--border)',
                borderRadius: 4, color: 'var(--text-primary)', outline: 'none',
                fontFamily: 'var(--font-mono)',
              }} />
          </div>
          <div style={{ overflowY: 'auto', flex: 1 }}>
            <div onClick={() => { onSelect('', repoIdVal); setOpen(false); setQuery('') }}
              style={{ padding: '5px 12px', fontSize: 11, cursor: 'pointer', color: 'var(--text-muted)', fontStyle: 'italic' }}
              onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-hover)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
              — {placeholder}
            </div>
            {groups.length === 0 && (
              <div style={{ padding: 12, fontSize: 12, color: 'var(--text-muted)', textAlign: 'center' }}>No results</div>
            )}
            {KIND_ORDER.flatMap(kind =>
              groups.filter(g => g.kind === kind).map(group => (
                <div key={group.key}>
                  <div style={{
                    padding: '4px 12px 2px', fontSize: 10, fontWeight: 700,
                    color: 'var(--text-muted)', letterSpacing: '0.07em', textTransform: 'uppercase',
                    background: 'var(--bg-surface)', borderTop: '1px solid var(--border)',
                    display: 'flex', alignItems: 'center', gap: 6,
                  }}>
                    {group.repoName !== 'this' && (
                      <span style={{ background: 'rgba(59,130,246,.2)', color: 'var(--accent-blue)',
                        padding: '1px 5px', borderRadius: 3, fontSize: 9, fontWeight: 700 }}>
                        {group.repoName}
                      </span>
                    )}
                    {KIND_LABEL[group.kind] ?? group.kind}
                  </div>
                  {group.items.map(o => {
                    const isSel = o.ref === value && o.repoId === repoIdVal
                    const rp    = o.repoName !== 'this' ? o.repoName + '/' : ''
                    const cl    = o.label.startsWith(rp) ? o.label.slice(rp.length) : o.label
                    return (
                      <div key={o.repoId + '|' + o.ref}
                        onClick={() => { onSelect(o.ref, o.repoId); setOpen(false); setQuery('') }}
                        style={{
                          padding: '4px 12px', cursor: 'pointer', fontSize: 12,
                          background: isSel ? 'rgba(59,130,246,.12)' : 'transparent',
                          color: isSel ? accentColor : 'var(--text-primary)',
                          display: 'flex', alignItems: 'baseline', gap: 8,
                        }}
                        onMouseEnter={e => { if (!isSel) e.currentTarget.style.background = 'var(--bg-hover)' }}
                        onMouseLeave={e => { if (!isSel) e.currentTarget.style.background = 'transparent' }}>
                        {o.kind === 'commit' && (
                          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: accentColor, flexShrink: 0 }}>
                            {o.ref}
                          </span>
                        )}
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                          fontSize: o.kind === 'commit' ? 11 : 12,
                          color: o.kind === 'commit' ? 'var(--text-secondary)' : 'inherit' }}>
                          {o.kind === 'commit' ? cl.replace(o.ref, '').replace(/^[\s·|]+/, '').trim() : cl}
                        </span>
                      </div>
                    )
                  })}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Explorer panel ───────────────────────────────────────────────────────────
function ExplorerPanel({
  label, sublabel, color, tree, open, toggle, side,
  selectedPath, onSelectPath, selIdx,
}: {
  label: string; sublabel?: string; color: string; tree: FNode
  open: Set<string>; toggle: (p: string) => void
  side: 'left' | 'right'
  selectedPath: string | null
  onSelectPath: (p: string) => void
  selIdx: number | null
}) {
  return (
    <div style={{
      width: 215, flexShrink: 0, display: 'flex', flexDirection: 'column',
      background: 'var(--bg-elevated)', overflow: 'hidden',
      borderRight: side === 'left'  ? '1px solid var(--border)' : undefined,
      borderLeft:  side === 'right' ? '1px solid var(--border)' : undefined,
    }}>
      {/* Header */}
      <div style={{
        padding: '4px 8px 3px', background: 'var(--bg-surface)',
        borderBottom: '1px solid var(--border)', flexShrink: 0,
      }}>
        <div style={{
          fontSize: 9, fontWeight: 700, color, letterSpacing: '0.07em',
          textTransform: 'uppercase', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {label}
        </div>
        {sublabel && (
          <div style={{
            fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {sublabel}
          </div>
        )}
        {selectedPath && (
          <div style={{
            marginTop: 2, fontSize: 10, fontFamily: 'var(--font-mono)',
            color: 'var(--accent-blue)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }} title={selectedPath}>
            ✓ {selectedPath.split('/').pop()}
          </div>
        )}
      </div>
      {/* Tree */}
      <div style={{ overflowY: 'auto', flex: 1, paddingTop: 4 }}>
        <FileTreeNode
          node={tree} depth={0}
          selIdx={selIdx}
          openDirs={open} toggleDir={toggle}
          selectedPath={selectedPath}
          onSelectPath={onSelectPath}
        />
      </div>
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────
export default function DiffPage() {
  const { repoId } = useParams<{ repoId: string }>()
  const [sp]       = useSearchParams()

  const [base,       setBase]       = useState(sp.get('base') || '')
  const [compare,    setCompare]    = useState(sp.get('branch') || '')
  const [baseRepoId, setBaseRepoId] = useState(repoId!)
  const [cmpRepoId,  setCmpRepoId]  = useState(repoId!)
  const [working,    setWorking]    = useState(false)
  const [crossMode,  setCrossMode]  = useState(false)
  const [debugMode,  setDebugMode]  = useState(false)

  // Independent file selection — each side picks its own file freely
  const [baseSelPath, setBaseSelPath] = useState<string | null>(null)
  const [cmpSelPath,  setCmpSelPath]  = useState<string | null>(null)

  const [baseOpen, setBaseOpen] = useState<Set<string>>(new Set())
  const [cmpOpen,  setCmpOpen]  = useState<Set<string>>(new Set())

  const toggleBase = (p: string) => setBaseOpen(s => { const n = new Set(s); n.has(p) ? n.delete(p) : n.add(p); return n })
  const toggleCmp  = (p: string) => setCmpOpen (s => { const n = new Set(s); n.has(p) ? n.delete(p) : n.add(p); return n })

  // Reset selections when refs change
  useEffect(() => { setBaseSelPath(null); setCmpSelPath(null) }, [base, compare, baseRepoId, cmpRepoId, working])

  // ── Refs ──────────────────────────────────────────────────────────────────
  const { data: refs = [], isLoading: refsLoading, refetch } =
    useQuery<RefInfo[]>({ queryKey: ['refs', repoId], queryFn: () => getRefs(repoId!), staleTime: 15000 })

  const { data: allRefs = [], isLoading: allRefsLoading, refetch: refetchAll } =
    useQuery<RefEntry[]>({
      queryKey: ['all-refs', repoId], queryFn: () => getAllRefs(repoId!),
      staleTime: 15000, enabled: crossMode,
    })

  const baseRef = base || 'HEAD'
  const cmpRef  = compare || 'HEAD'

  // ── Overview diff (git diff between refs) ─────────────────────────────────
  const hasRef = working || !!(base || compare)
  const { data: rawFiles = [], isLoading: diffLoading, error: diffError } =
    useQuery<DiffFile[]>({
      queryKey: ['diff', repoId, base, baseRepoId, compare, cmpRepoId, working, crossMode],
      queryFn: () => {
        if (working) return getWorkingDiff(repoId!)
        if (crossMode) return getCrossDiff(
          repoId!, base || undefined, compare || undefined,
          cmpRepoId  !== repoId ? cmpRepoId  : undefined,
          baseRepoId !== repoId ? baseRepoId : undefined,
        )
        return getDiff(repoId!, base || undefined, compare || undefined)
      },
      enabled: !!repoId && hasRef,
      retry: false,
    })

  // ── File-pair diff: when user independently picks one file from each side ──
  const { data: pairDiffRaw, isLoading: pairLoading } = useQuery<DiffFile>({
    queryKey: ['file-pair-diff', baseRepoId, baseRef, baseSelPath, cmpRepoId, cmpRef, cmpSelPath],
    queryFn: () => getFilePairDiff(
      repoId!, baseRef, baseSelPath!, baseRepoId,
      cmpRef, cmpSelPath!, cmpRepoId,
    ),
    // Guard: both paths must be set AND not identical within the same repo
    enabled: !working && !!baseSelPath && !!cmpSelPath &&
      !(baseSelPath === cmpSelPath && baseRepoId === cmpRepoId),
    retry: false,
  })

  // ── File trees ────────────────────────────────────────────────────────────
  const { data: baseFileList = [] } = useQuery<FileEntry[]>({
    queryKey: ['ref-tree', baseRepoId, baseRef, crossMode],
    queryFn: () => baseRepoId !== repoId
      ? getCrossRefTree(repoId!, baseRef, baseRepoId)
      : getRefTree(repoId!, baseRef),
    enabled: !!repoId && hasRef && !working,
    staleTime: 30000,
  })

  const { data: cmpFileList = [] } = useQuery<FileEntry[]>({
    queryKey: ['ref-tree', cmpRepoId, cmpRef, crossMode],
    queryFn: () => cmpRepoId !== repoId
      ? getCrossRefTree(repoId!, cmpRef, cmpRepoId)
      : getRefTree(repoId!, cmpRef),
    enabled: !!repoId && hasRef && !working,
    staleTime: 30000,
  })

  // ── Debug ─────────────────────────────────────────────────────────────────
  const { data: debugData, isLoading: debugLoading, refetch: refetchDebug } =
    useQuery({
      queryKey: ['diff-debug', repoId, base, compare],
      queryFn: () => getDiffDebug(repoId!, base || undefined, compare || undefined),
      enabled: debugMode && !!repoId && hasRef && !working,
      retry: false,
    })

  const files    = rawFiles as DiffFile[]
  const totalAdd = files.reduce((s, f) => s + f.additions, 0)
  const totalDel = files.reduce((s, f) => s + f.deletions, 0)

  // ── Status maps (for diff highlights in tree) ─────────────────────────────
  const baseStatusMap = useMemo(() => {
    const m = new Map<string, { status: DiffStatus; index: number }>()
    files.forEach((f, i) => {
      const key = f.old_path
      if (!key) return
      const isRename = !!(f.path && f.path !== f.old_path)
      const status: DiffStatus = isRename ? 'renamed'
        : !f.path           ? 'removed'
        : f.additions === 0 ? 'removed'
        : f.deletions === 0 ? 'added'
        : 'modified'
      if (!m.has(key)) m.set(key, { status, index: i })
    })
    return m
  }, [files])

  const cmpStatusMap = useMemo(() => {
    const m = new Map<string, { status: DiffStatus; index: number }>()
    files.forEach((f, i) => {
      const key = f.path
      if (!key) return
      const isRename = !!(f.old_path && f.old_path !== f.path)
      const status: DiffStatus = isRename ? 'renamed'
        : !f.old_path        ? 'added'
        : f.deletions === 0  ? 'added'
        : f.additions === 0  ? 'removed'
        : 'modified'
      if (!m.has(key)) m.set(key, { status, index: i })
    })
    return m
  }, [files])

  // ── Trees ─────────────────────────────────────────────────────────────────
  const baseTree = useMemo(() => {
    const s = new Set((baseFileList as FileEntry[]).map(f => f.path))
    files.forEach(f => { if (f.old_path) s.add(f.old_path) })
    return buildFileTree([...s], baseStatusMap)
  }, [baseFileList, baseStatusMap, files])

  const cmpTree = useMemo(() => {
    const s = new Set((cmpFileList as FileEntry[]).map(f => f.path))
    files.forEach(f => { if (f.path) s.add(f.path) })
    return buildFileTree([...s], cmpStatusMap)
  }, [cmpFileList, cmpStatusMap, files])

  // Working-tree explorer tree (same list shown on both sides)
  const workingTree = useMemo(() => {
    const s = new Set<string>()
    files.forEach(f => { if (f.path) s.add(f.path); if (f.old_path) s.add(f.old_path) })
    return buildFileTree([...s], cmpStatusMap)
  }, [files, cmpStatusMap])

  // Auto-expand folders with diffs
  useEffect(() => {
    const expand = (node: FNode): Set<string> => {
      const out = new Set<string>()
      const walk = (n: FNode) => {
        if (n.isDir && n.name && hasDiffDescendant(n)) out.add(n.path)
        n.children.forEach(c => c.isDir && walk(c))
      }
      walk(node)
      return out
    }
    setBaseOpen(expand(baseTree))
    setCmpOpen(expand(cmpTree))
  }, [baseTree, cmpTree])

  // ── Picker options ────────────────────────────────────────────────────────
  const rl = refs as RefInfo[]
  const simpleOptions: PickerOption[] = rl.map(r => ({
    label: r.label, ref: r.ref, repoId: repoId!, repoName: 'this', kind: r.kind,
  }))

  const arl = allRefs as RefEntry[]
  const repoNameMap = new Map<string, string>([[repoId!, 'this']])
  arl.filter(r => r.repo_id !== repoId).forEach(r => {
    if (!repoNameMap.has(r.repo_id)) repoNameMap.set(r.repo_id, r.label.split('/')[0])
  })
  const crossOptions: PickerOption[] = arl.map(r => ({
    label: r.label, ref: r.ref, repoId: r.repo_id,
    repoName: repoNameMap.get(r.repo_id) ?? r.repo_id.slice(0, 8),
    kind: r.kind,
  }))

  // ── What to show in the centre panel ─────────────────────────────────────
  // Priority: if both sides have an independent selection → file-pair diff
  // Otherwise: if baseSelPath only → show that file in full (added view)
  //            if cmpSelPath only  → show that file in full
  //            neither selected    → show nothing / prompt
  const sameFileSameRepo = !!baseSelPath && baseSelPath === cmpSelPath && baseRepoId === cmpRepoId
  const bothSelected  = !!baseSelPath && !!cmpSelPath && !sameFileSameRepo
  const neitherSelected = !baseSelPath && !cmpSelPath
  const needsPick = !working && !(base || compare)

  const repoNameOf = (rid: string) =>
    repoNameMap.get(rid) ?? rid.slice(0, 8)

  return (
    <div style={{ padding: 24, minHeight: '100%', display: 'flex', flexDirection: 'column', boxSizing: 'border-box' }}>
      <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 4 }}>Diff Viewer</h1>
      <p style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 14 }}>
        Compare branches, tags, commits — within or across repositories.
      </p>

      {/* Controls */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <button className={`btn btn-sm ${crossMode ? 'btn-primary' : 'btn-ghost'}`}
          onClick={() => {
            setCrossMode(c => !c); setBase(''); setCompare('')
            setBaseRepoId(repoId!); setCmpRepoId(repoId!)
          }}>
          <GitFork size={13} /> Cross-Repo
        </button>
        <div style={{ width: 1, height: 20, background: 'var(--border)' }} />

        {crossMode ? (<>
          <RefPicker options={crossOptions} value={base} repoIdVal={baseRepoId}
            onSelect={(ref, rid) => { setBase(ref); setBaseRepoId(rid || repoId!) }}
            placeholder="Base ref…" accentColor="var(--accent-red-hover)" />
          <button className="btn btn-ghost btn-icon"
            onClick={() => { setBase(compare); setCompare(base); setBaseRepoId(cmpRepoId); setCmpRepoId(baseRepoId) }}>
            <ArrowLeftRight size={14} />
          </button>
          <RefPicker options={crossOptions} value={compare} repoIdVal={cmpRepoId}
            onSelect={(ref, rid) => { setCompare(ref); setCmpRepoId(rid || repoId!) }}
            placeholder="Compare ref…" accentColor="var(--diff-add-text)" />
          <button className="btn btn-ghost btn-icon" onClick={() => refetchAll()} disabled={allRefsLoading}>
            <RefreshCw size={13} className={allRefsLoading ? 'spin' : ''} />
          </button>
        </>) : (<>
          <RefPicker options={simpleOptions} value={base} repoIdVal={repoId!}
            onSelect={ref => setBase(ref)}
            placeholder="Base…" accentColor="var(--accent-red-hover)" />
          <button className="btn btn-ghost btn-icon" onClick={() => { setBase(compare); setCompare(base) }}>
            <ArrowLeftRight size={14} />
          </button>
          <RefPicker options={simpleOptions} value={compare} repoIdVal={repoId!}
            onSelect={ref => setCompare(ref)}
            placeholder="Compare…" accentColor="var(--diff-add-text)" />
          <button className={`btn btn-sm ${working ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => setWorking(w => !w)}>
            <Eye size={13} /> Working Tree
          </button>
          <button className="btn btn-ghost btn-icon" onClick={() => refetch()} disabled={refsLoading}>
            <RefreshCw size={13} className={refsLoading ? 'spin' : ''} />
          </button>
          <button className={`btn btn-sm ${debugMode ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => { setDebugMode(d => !d); if (!debugMode) setTimeout(() => refetchDebug(), 0) }}>
            <Bug size={13} /> Debug
          </button>
        </>)}

        {(totalAdd > 0 || totalDel > 0) && (
          <span style={{ marginLeft: 'auto', fontSize: 13 }}>
            <span style={{ color: 'var(--diff-add-text)' }}>+{totalAdd}</span>
            {' / '}
            <span style={{ color: 'var(--accent-red-hover)' }}>-{totalDel}</span>
            {' · '}{files.length} changed file{files.length !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      {!refsLoading && !crossMode && refs.length === 0 && (
        <div className="guide-tip" style={{ marginBottom: 10 }}>
          <GitBranch size={15} />
          <span>No branches — click <strong>Sync</strong> on the repo overview first.</span>
        </div>
      )}

      {debugMode && hasRef && !working && (
        <div style={{ marginBottom: 10, padding: 10, background: 'var(--bg-elevated)', borderRadius: 8, border: '1px solid var(--border)', fontSize: 12 }}>
          <div style={{ fontWeight: 700, marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6, color: 'var(--text-secondary)' }}>
            <Bug size={13} /> Git Diff Debug
            <button className="btn btn-ghost btn-sm" style={{ marginLeft: 'auto' }} onClick={() => refetchDebug()} disabled={debugLoading}>
              {debugLoading ? 'Loading…' : 'Re-run'}
            </button>
          </div>
          {debugData && (
            <pre style={{ overflow: 'auto', maxHeight: 220, fontSize: 11, color: 'var(--text-muted)', margin: 0, whiteSpace: 'pre-wrap' }}>
              {JSON.stringify(debugData, null, 2)}
            </pre>
          )}
        </div>
      )}

      {/* Main three-column layout */}
      {diffLoading ? (
        <div className="loading"><div className="spinner" /> Computing diff…</div>
      ) : diffError ? (
        <div className="empty-state" style={{ color: 'var(--accent-red-hover)' }}>
          <Code size={40} /><p>{(diffError as Error).message}</p>
        </div>
      ) : needsPick ? (
        <div className="empty-state">
          <Code size={48} />
          <p style={{ textAlign: 'center' }}>
            Pick a base and/or compare ref above<br />
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Branches, tags, commits — all work</span>
          </p>
        </div>
      ) : (
        <div style={{
          display: 'flex',
          height: 'calc(100vh - 260px)', minHeight: 400,
          border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden',
        }}>

          {/* LEFT explorer */}
          <ExplorerPanel
            label={working ? 'Working Tree' : crossMode ? `Base · ${repoNameOf(baseRepoId)}` : 'Base'}
            sublabel={working ? 'changed files' : base || 'HEAD'}
            color={working ? 'var(--accent-blue)' : 'var(--accent-red-hover)'}
            tree={working ? workingTree : baseTree}
            open={baseOpen} toggle={toggleBase}
            side="left"
            selectedPath={baseSelPath}
            onSelectPath={p => {
              setBaseSelPath(prev => prev === p ? null : p)
            }}
            selIdx={null}
          />

          {/* CENTRE — instruction bar + diff view */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'hidden' }}>

            {/* Instruction bar — always visible when refs are set */}
            {(!working || files.length > 0) && (
              <div style={{
                padding: '5px 12px', background: 'var(--bg-surface)',
                borderBottom: '1px solid var(--border)', flexShrink: 0,
                display: 'flex', alignItems: 'center', gap: 10, fontSize: 11,
              }}>
                {working ? (
                  <span style={{ color: 'var(--text-muted)' }}>
                    {baseSelPath
                      ? <><span style={{ color: 'var(--accent-blue)', fontFamily: 'var(--font-mono)' }}>{baseSelPath.split('/').pop()}</span> — working tree changes</>
                      : <>Click a file in the explorer to view its diff</>
                    }
                  </span>
                ) : neitherSelected ? (
                  <span style={{ color: 'var(--text-muted)' }}>
                    Click any file on the <span style={{ color: 'var(--accent-red-hover)' }}>left</span> and <span style={{ color: 'var(--diff-add-text)' }}>right</span> to compare them independently
                  </span>
                ) : !bothSelected ? (
                  <span style={{ color: 'var(--text-muted)' }}>
                    {baseSelPath
                      ? <><span style={{ color: 'var(--accent-red-hover)', fontFamily: 'var(--font-mono)' }}>{baseSelPath.split('/').pop()}</span> selected on left — now pick a file on the right</>
                      : <>now pick a file on the <span style={{ color: 'var(--accent-red-hover)' }}>left</span></>
                    }
                    {cmpSelPath
                      ? <> · <span style={{ color: 'var(--diff-add-text)', fontFamily: 'var(--font-mono)' }}>{cmpSelPath.split('/').pop()}</span> selected on right — now pick a file on the left</>
                      : null
                    }
                  </span>
                ) : (
                  <span style={{ color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)', fontSize: 11 }}>
                    <span style={{ color: 'var(--accent-red-hover)' }}>{baseSelPath!.split('/').pop()}</span>
                    <span style={{ color: 'var(--text-muted)', margin: '0 6px' }}>↔</span>
                    <span style={{ color: 'var(--diff-add-text)' }}>{cmpSelPath!.split('/').pop()}</span>
                  </span>
                )}
                {(baseSelPath || cmpSelPath) && (
                  <button className="btn btn-ghost btn-sm" style={{ marginLeft: 'auto' }}
                    onClick={() => { setBaseSelPath(null); setCmpSelPath(null) }}>
                    ✕ Clear selection
                  </button>
                )}
                {/* Changed files summary chips */}
                {files.length > 0 && neitherSelected && (
                  <span style={{ marginLeft: 'auto', color: 'var(--text-muted)', fontSize: 10 }}>
                    {files.length} changed file{files.length !== 1 ? 's' : ''} highlighted in trees
                  </span>
                )}
              </div>
            )}

            {/* Diff content area */}
            <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
              {working ? (
                /* Working tree mode — file selected via left explorer */
                files.length === 0 ? (
                  <div className="empty-state" style={{ padding: 60 }}>
                    <Code size={40} /><p>Working tree is clean</p>
                  </div>
                ) : !baseSelPath ? (
                  <div className="empty-state" style={{ padding: 60 }}>
                    <Code size={40} />
                    <p style={{ textAlign: 'center' }}>
                      Click a file in the explorer to view its diff<br />
                      <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                        {files.length} file{files.length !== 1 ? 's' : ''} changed in working tree
                      </span>
                    </p>
                  </div>
                ) : (() => {
                  const wf = files.find(f => f.path === baseSelPath || f.old_path === baseSelPath)
                  return wf
                    ? (wf.is_binary
                        ? <div className="empty-state" style={{ padding: 40 }}><File size={32} /><p>Binary file</p></div>
                        : <SideBySide file={wf} />)
                    : <div className="empty-state" style={{ padding: 40 }}><Code size={32} /><p>File not in diff</p></div>
                })()
              ) : sameFileSameRepo ? (
                <div className="empty-state" style={{ padding: 60 }}>
                  <Code size={40} />
                  <p style={{ textAlign: 'center' }}>
                    Same file selected on both sides<br />
                    <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                      Pick a different file on one side, or switch one side to a different ref
                    </span>
                  </p>
                </div>
              ) : bothSelected ? (
                /* Both sides selected — show file-pair diff */
                pairLoading ? (
                  <div className="loading"><div className="spinner" /> Comparing files…</div>
                ) : pairDiffRaw ? (
                  <>
                    <div style={{
                      padding: '6px 12px', background: 'var(--bg-surface)',
                      borderBottom: '1px solid var(--border)',
                      display: 'flex', alignItems: 'center', gap: 8,
                      position: 'sticky', top: 0, zIndex: 2,
                    }}>
                      <Code size={13} color="var(--text-muted)" />
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        <span style={{ color: 'var(--accent-red-hover)', opacity: 0.8, fontSize: 11 }}>
                          {crossMode && baseRepoId !== cmpRepoId ? repoNameOf(baseRepoId) + '/' : ''}
                        </span>
                        {baseSelPath}
                        <span style={{ color: 'var(--text-muted)', margin: '0 8px' }}>↔</span>
                        <span style={{ color: 'var(--diff-add-text)', opacity: 0.8, fontSize: 11 }}>
                          {crossMode && baseRepoId !== cmpRepoId ? repoNameOf(cmpRepoId) + '/' : ''}
                        </span>
                        {cmpSelPath}
                      </span>
                      <span style={{ color: 'var(--diff-add-text)', fontSize: 11 }}>+{(pairDiffRaw as DiffFile).additions}</span>
                      <span style={{ color: 'var(--accent-red-hover)', fontSize: 11, marginLeft: 4 }}>-{(pairDiffRaw as DiffFile).deletions}</span>
                    </div>
                    <SideBySide file={pairDiffRaw as DiffFile} />
                  </>
                ) : (
                  <div className="empty-state" style={{ padding: 40 }}>
                    <Code size={32} /><p>Could not compare these files</p>
                  </div>
                )
              ) : (
                /* No independent selection — show prompt */
                <div className="empty-state" style={{ padding: 60 }}>
                  <FileX size={40} />
                  <p style={{ textAlign: 'center' }}>
                    Select a file from each panel to compare<br />
                    <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                      {files.length > 0
                        ? 'Highlighted files changed between refs — or pick any two files freely'
                        : 'Pick any file from the left and right panels'}
                    </span>
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* RIGHT explorer — compare side */}
          {!working && (
            <ExplorerPanel
              label={crossMode ? `Compare · ${repoNameOf(cmpRepoId)}` : 'Compare'}
              sublabel={compare || 'HEAD'}
              color="var(--diff-add-text)"
              tree={cmpTree} open={cmpOpen} toggle={toggleCmp}
              side="right"
              selectedPath={cmpSelPath}
              onSelectPath={p => {
                setCmpSelPath(prev => prev === p ? null : p)
              }}
              selIdx={null}
            />
          )}
        </div>
      )}
    </div>
  )
}

// ─── Working tree file list ───────────────────────────────────────────────────
function WorkingTreeView({ files }: { files: DiffFile[] }) {
  const [selIdx, setSelIdx] = useState(0)
  const curFile = files[selIdx]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* File tabs */}
      <div style={{ display: 'flex', overflowX: 'auto', borderBottom: '1px solid var(--border)', background: 'var(--bg-elevated)', flexShrink: 0 }}>
        {files.map((f, i) => {
          const isRename = f.old_path && f.old_path !== f.path
          const st: DiffStatus = isRename ? 'renamed'
            : !f.old_path ? 'added'
            : !f.path     ? 'removed'
            : 'modified'
          return (
            <div key={i} onClick={() => setSelIdx(i)} title={f.path || f.old_path}
              style={{
                padding: '4px 10px', cursor: 'pointer', fontSize: 11,
                fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap',
                borderRight: '1px solid var(--border)',
                background: i === selIdx ? 'rgba(59,130,246,.12)' : 'transparent',
                color: i === selIdx ? 'var(--text-primary)' : S_COLOR[st],
                display: 'flex', alignItems: 'center', gap: 5,
                borderBottom: i === selIdx ? '2px solid var(--accent-blue)' : '2px solid transparent',
              }}
              onMouseEnter={e => { if (i !== selIdx) e.currentTarget.style.background = 'var(--bg-hover)' }}
              onMouseLeave={e => { if (i !== selIdx) e.currentTarget.style.background = 'transparent' }}>
              {S_ICON[st]}
              {(f.path || f.old_path || '').split('/').pop()}
            </div>
          )
        })}
      </div>
      {/* Diff */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {curFile && (curFile.is_binary
          ? <div className="empty-state" style={{ padding: 40 }}><File size={32} /><p>Binary file</p></div>
          : <SideBySide file={curFile} />
        )}
      </div>
    </div>
  )
}

// ─── Side-by-side diff ────────────────────────────────────────────────────────
function SideBySide({ file }: { file: DiffFile }) {
  type Row = { content: string; type: string; num: number | null }
  const L: Row[] = [], R: Row[] = []
  let lo = 0, ro = 0

  const isNewFile     = !file.old_path
  const isDeletedFile = !file.path

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

  const bg = (t: string) =>
    t === 'removed' ? 'var(--diff-remove-bg)' :
    t === 'added'   ? 'var(--diff-add-bg)'    :
    t === 'header'  ? 'var(--diff-header-bg)' : 'transparent'
  const fg = (t: string) =>
    t === 'removed' ? 'var(--diff-remove-text)' :
    t === 'added'   ? 'var(--diff-add-text)'    :
    t === 'header'  ? 'var(--text-muted)'       : 'var(--text-primary)'

  const AbsentPanel = ({ label, side }: { label: string; side: 'base' | 'compare' }) => (
    <div style={{ display: 'flex', flexDirection: 'column', borderRight: side === 'base' ? '1px solid var(--border)' : undefined }}>
      <div style={{ padding: '2px 8px', background: 'var(--bg-elevated)', fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, borderBottom: '1px solid var(--border)', position: 'sticky', top: 0 }}>
        {label}
      </div>
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: 12, fontStyle: 'italic', padding: 24,
        background: side === 'base' ? 'rgba(239,68,68,.04)' : 'rgba(34,197,94,.04)' }}>
        {side === 'base' ? '— file does not exist in base —' : '— file does not exist in compare —'}
      </div>
    </div>
  )

  const DiffPanel = ({ rows, fp, stat, isRight }: { rows: Row[]; fp: string; stat: React.ReactNode; isRight?: boolean }) => (
    <div style={{ overflow: 'auto', borderRight: !isRight ? '1px solid var(--border)' : undefined }}>
      <div style={{ padding: '2px 8px', background: 'var(--bg-elevated)', fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, borderBottom: '1px solid var(--border)', display: 'flex', gap: 8, position: 'sticky', top: 0 }}>
        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>{fp}</span>
        {stat}
      </div>
      {rows.map((row, i) => (
        <div key={i} style={{ display: 'flex', fontFamily: 'var(--font-mono)', fontSize: 12, minHeight: 20, background: bg(row.type) }}>
          <span style={{ minWidth: 38, padding: '0 5px', textAlign: 'right', color: 'var(--text-muted)', borderRight: '1px solid var(--border-muted)', fontSize: 11, userSelect: 'none', flexShrink: 0 }}>
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

  const baseFp    = file.old_path || file.path
  const compareFp = file.path     || file.old_path

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', borderTop: '1px solid var(--border)' }}>
      {isNewFile
        ? <AbsentPanel label={`(does not exist) → ${compareFp}`} side="base" />
        : <DiffPanel rows={L} fp={baseFp} stat={<span style={{ color: 'var(--accent-red-hover)' }}>-{file.deletions}</span>} />}
      {isDeletedFile
        ? <AbsentPanel label={`${baseFp} → (deleted)`} side="compare" />
        : <DiffPanel rows={R} fp={compareFp} stat={<span style={{ color: 'var(--diff-add-text)' }}>+{file.additions}</span>} isRight />}
    </div>
  )
}
