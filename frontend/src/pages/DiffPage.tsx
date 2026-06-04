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
        child = {
          name: parts[i], path: np, isDir: !isLast, children: [],
          diffStatus: info?.status ?? null,
          diffIndex: info?.index,
        }
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

// ─── File tree node component ─────────────────────────────────────────────────
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

function FileTreeNode({ node, depth, selIdx, onSelect, openDirs, toggleDir, selectedPath, onSelectPath }: {
  node: FNode; depth: number; selIdx: number | null
  onSelect: (i: number) => void
  openDirs: Set<string>; toggleDir: (p: string) => void
  selectedPath?: string | null; onSelectPath?: (path: string) => void
}) {
  // Root node — render children directly
  if (node.isDir && !node.name) {
    return (
      <>
        {node.children.map(c => (
          <FileTreeNode key={c.path} node={c} depth={depth} selIdx={selIdx}
            onSelect={onSelect} openDirs={openDirs} toggleDir={toggleDir}
            selectedPath={selectedPath} onSelectPath={onSelectPath} />
        ))}
      </>
    )
  }

  const indent = depth * 12

  if (node.isDir) {
    const isOpen  = openDirs.has(node.path)
    const active  = containsFileIdx(node, selIdx)
    const hasChg  = hasDiffDescendant(node)
    return (
      <div>
        <div
          onClick={() => toggleDir(node.path)}
          style={{
            display: 'flex', alignItems: 'center', gap: 4,
            padding: '2px 6px', paddingLeft: 4 + indent,
            cursor: 'pointer', userSelect: 'none', fontSize: 11,
            color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
            fontWeight: active ? 600 : 400,
          }}
          onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-hover)')}
          onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
        >
          {isOpen
            ? <FolderOpen size={12} color="var(--accent-blue)" />
            : <Folder    size={12} color={hasChg ? '#f59e0b' : 'var(--text-muted)'} />}
          <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {node.name}
          </span>
        </div>
        {isOpen && node.children.map(c => (
          <FileTreeNode key={c.path} node={c} depth={depth + 1} selIdx={selIdx}
            onSelect={onSelect} openDirs={openDirs} toggleDir={toggleDir}
            selectedPath={selectedPath} onSelectPath={onSelectPath} />
        ))}
      </div>
    )
  }

  // File leaf
  const isSel      = node.diffIndex === selIdx
  const isPathSel  = !!selectedPath && node.path === selectedPath
  const hasDiff    = !!node.diffStatus
  const isClickable = hasDiff || !!onSelectPath
  const color = isPathSel
    ? 'var(--accent-blue)'
    : isSel
      ? (node.diffStatus ? S_COLOR[node.diffStatus] : 'var(--accent-blue)')
      : hasDiff ? S_COLOR[node.diffStatus!] : 'var(--text-muted)'

  return (
    <div
      onClick={() => {
        if (onSelectPath) {
          onSelectPath(node.path)
        } else if (node.diffIndex != null) {
          onSelect(node.diffIndex)
        }
      }}
      style={{
        display: 'flex', alignItems: 'center', gap: 4,
        padding: '2px 6px', paddingLeft: 4 + indent,
        cursor: isClickable ? 'pointer' : 'default',
        userSelect: 'none', fontSize: 11,
        background: isPathSel ? 'rgba(59,130,246,.18)' : isSel ? 'rgba(59,130,246,.13)' : 'transparent',
        color, opacity: isClickable ? 1 : 0.4,
        outline: isPathSel ? '1px solid var(--accent-blue)' : undefined,
      }}
      onMouseEnter={e => { if (isClickable && !isSel && !isPathSel) e.currentTarget.style.background = 'var(--bg-hover)' }}
      onMouseLeave={e => { if (!isSel && !isPathSel) e.currentTarget.style.background = 'transparent' }}
    >
      {node.diffStatus ? S_ICON[node.diffStatus] : <File size={11} color={isPathSel ? 'var(--accent-blue)' : 'var(--text-muted)'} />}
      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: (hasDiff || isPathSel) ? 500 : 400 }}>
        {node.name}
      </span>
    </div>
  )
}

// ─── Searchable ref picker ────────────────────────────────────────────────────
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

  const q        = query.toLowerCase()
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

  const selected     = options.find(o => o.ref === value && o.repoId === repoIdVal)
  const displayLabel = selected
    ? (selected.repoName !== 'this' ? selected.repoName + ' / ' : '') +
      (selected.kind === 'commit' ? selected.ref : (() => {
        const prefix = selected.repoName !== 'this' ? selected.repoName + '/' : ''
        return selected.label.startsWith(prefix) ? selected.label.slice(prefix.length) : selected.label
      })())
    : placeholder

  const KIND_LABEL: Record<string, string> = { branch: 'Branches', tag: 'Tags', commit: 'Commits' }
  const KIND_ORDER = ['branch', 'tag', 'commit']

  return (
    <div ref={wrapRef} style={{ position: 'relative', display: 'inline-block', minWidth: 240 }}>
      <button
        onClick={() => { setOpen(o => !o); setQuery('') }}
        style={{
          width: '100%', textAlign: 'left', padding: '4px 10px',
          background: 'var(--bg-surface)', border: '1px solid var(--border)',
          borderRadius: 6, cursor: 'pointer', fontSize: 12,
          fontFamily: 'var(--font-mono)',
          color: selected ? accentColor : 'var(--text-muted)',
          display: 'flex', alignItems: 'center', gap: 6,
        }}
      >
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
            <input
              autoFocus
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search branch, tag, commit…"
              style={{
                width: '100%', padding: '4px 8px', fontSize: 12, boxSizing: 'border-box',
                background: 'var(--bg-surface)', border: '1px solid var(--border)',
                borderRadius: 4, color: 'var(--text-primary)', outline: 'none',
                fontFamily: 'var(--font-mono)',
              }}
            />
          </div>

          <div style={{ overflowY: 'auto', flex: 1 }}>
            <div
              onClick={() => { onSelect('', repoIdVal); setOpen(false); setQuery('') }}
              style={{ padding: '5px 12px', fontSize: 11, cursor: 'pointer', color: 'var(--text-muted)', fontStyle: 'italic' }}
              onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-hover)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
            >
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
                      <span style={{
                        background: 'rgba(59,130,246,.2)', color: 'var(--accent-blue)',
                        padding: '1px 5px', borderRadius: 3, fontSize: 9, fontWeight: 700,
                      }}>
                        {group.repoName}
                      </span>
                    )}
                    {KIND_LABEL[group.kind] ?? group.kind}
                  </div>
                  {group.items.map(o => {
                    const isSel    = o.ref === value && o.repoId === repoIdVal
                    const isCommit = o.kind === 'commit'
                    // Strip repo prefix from label if present (e.g. "reponame/main" -> "main")
                    const repoPrefix = o.repoName !== 'this' ? o.repoName + '/' : ''
                    const cleanLabel = o.label.startsWith(repoPrefix) ? o.label.slice(repoPrefix.length) : o.label
                    // For commits: first token is the hash, rest is message
                    const hashPart = isCommit ? o.ref : null
                    const msgPart  = isCommit
                      ? cleanLabel.replace(o.ref, '').replace(/^[\s·|]+/, '').trim()
                      : cleanLabel
                    return (
                      <div
                        key={o.repoId + '|' + o.ref}
                        onClick={() => { onSelect(o.ref, o.repoId); setOpen(false); setQuery('') }}
                        style={{
                          padding: '4px 12px', cursor: 'pointer', fontSize: 12,
                          background: isSel ? 'rgba(59,130,246,.12)' : 'transparent',
                          color: isSel ? accentColor : 'var(--text-primary)',
                          display: 'flex', alignItems: 'baseline', gap: 8,
                        }}
                        onMouseEnter={e => { if (!isSel) e.currentTarget.style.background = 'var(--bg-hover)' }}
                        onMouseLeave={e => { if (!isSel) e.currentTarget.style.background = 'transparent' }}
                      >
                        {hashPart && (
                          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: accentColor, flexShrink: 0 }}>
                            {hashPart}
                          </span>
                        )}
                        <span style={{
                          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                          fontSize: isCommit ? 11 : 12,
                          color: isCommit ? 'var(--text-secondary)' : 'inherit',
                        }}>
                          {msgPart}
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
  const [selIdx,     setSelIdx]     = useState<number | null>(null)
  // File-pair mode: independently select one file from each side for direct comparison
  const [pairBase,   setPairBase]   = useState<string | null>(null)  // base path
  const [pairCmp,    setPairCmp]    = useState<string | null>(null)  // compare path
  const [pairMode,   setPairMode]   = useState(false)
  const [baseOpen,   setBaseOpen]   = useState<Set<string>>(new Set())
  const [cmpOpen,    setCmpOpen]    = useState<Set<string>>(new Set())

  const toggleBase = (p: string) => setBaseOpen(s => { const n = new Set(s); n.has(p) ? n.delete(p) : n.add(p); return n })
  const toggleCmp  = (p: string) => setCmpOpen (s => { const n = new Set(s); n.has(p) ? n.delete(p) : n.add(p); return n })

  // ── Refs ──────────────────────────────────────────────────────────────────
  const { data: refs = [], isLoading: refsLoading, refetch } =
    useQuery<RefInfo[]>({ queryKey: ['refs', repoId], queryFn: () => getRefs(repoId!), staleTime: 15000 })

  const { data: allRefs = [], isLoading: allRefsLoading, refetch: refetchAll } =
    useQuery<RefEntry[]>({
      queryKey: ['all-refs', repoId], queryFn: () => getAllRefs(repoId!),
      staleTime: 15000, enabled: crossMode,
    })

  // ── Diff ──────────────────────────────────────────────────────────────────
  const hasRef = working || !!(base || compare)
  const { data: rawFiles = [], isLoading: diffLoading, error: diffError } =
    useQuery<DiffFile[]>({
      queryKey: ['diff', repoId, base, baseRepoId, compare, cmpRepoId, working, crossMode],
      queryFn: () => {
        if (working) return getWorkingDiff(repoId!)
        if (crossMode) return getCrossDiff(
          repoId!, base || undefined, compare || undefined,
          cmpRepoId !== repoId ? cmpRepoId : undefined,
          baseRepoId !== repoId ? baseRepoId : undefined,
        )
        return getDiff(repoId!, base || undefined, compare || undefined)
      },
      enabled: !!repoId && hasRef,
      retry: false,
    })

  // ── File trees ────────────────────────────────────────────────────────────
  const baseRef = base || 'HEAD'
  const cmpRef  = compare || 'HEAD'

  const { data: baseFileList = [] } = useQuery<FileEntry[]>({
    queryKey: ['ref-tree', baseRepoId, baseRef],
    queryFn: () => baseRepoId !== repoId
      ? getCrossRefTree(repoId!, baseRef, baseRepoId)
      : getRefTree(repoId!, baseRef),
    enabled: !!repoId && hasRef && !working,
    staleTime: 60000,
  })

  const { data: cmpFileList = [] } = useQuery<FileEntry[]>({
    queryKey: ['ref-tree', cmpRepoId, cmpRef],
    queryFn: () => cmpRepoId !== repoId
      ? getCrossRefTree(repoId!, cmpRef, cmpRepoId)
      : getRefTree(repoId!, cmpRef),
    enabled: !!repoId && hasRef && !working,
    staleTime: 60000,
  })

  // ── Debug ─────────────────────────────────────────────────────────────────
  const { data: debugData, isLoading: debugLoading, refetch: refetchDebug } =
    useQuery({
      queryKey: ['diff-debug', repoId, base, compare],
      queryFn: () => getDiffDebug(repoId!, base || undefined, compare || undefined),
      enabled: debugMode && !!repoId && hasRef && !working,
      retry: false,
    })

  // ── File-pair diff (cross-repo arbitrary file comparison) ───────────────
  const { data: pairDiffRaw, isLoading: pairLoading } = useQuery<DiffFile>({
    queryKey: ['file-pair-diff', baseRepoId, baseRef, pairBase, cmpRepoId, cmpRef, pairCmp],
    queryFn: () => getFilePairDiff(
      repoId!, baseRef, pairBase!, baseRepoId,
      cmpRef, pairCmp!, cmpRepoId,
    ),
    enabled: pairMode && !!pairBase && !!pairCmp,
    retry: false,
  })

  const files    = rawFiles as DiffFile[]
  const totalAdd = files.reduce((s, f) => s + f.additions, 0)
  const totalDel = files.reduce((s, f) => s + f.deletions, 0)

  // ── Status maps ───────────────────────────────────────────────────────────
  // After parseDiff fix:
  //   new file  → old_path="",  path="foo"   (only in compare)
  //   deleted   → old_path="foo", path=""    (only in base)
  //   modified  → old_path="foo", path="foo"
  //   renamed   → old_path="old", path="new"

  const baseStatusMap = useMemo(() => {
    const m = new Map<string, { status: DiffStatus; index: number }>()
    files.forEach((f, i) => {
      const key = f.old_path  // which path exists on the base side
      if (!key) return        // no old_path = new file, doesn't exist in base
      const isRename = !!(f.path && f.path !== f.old_path)
      const status: DiffStatus = isRename ? 'renamed'
        : !f.path              ? 'removed'   // deleted — no compare path
        : f.additions === 0    ? 'removed'
        : f.deletions === 0    ? 'added'
        : 'modified'
      if (!m.has(key)) m.set(key, { status, index: i })
    })
    return m
  }, [files])

  const cmpStatusMap = useMemo(() => {
    const m = new Map<string, { status: DiffStatus; index: number }>()
    files.forEach((f, i) => {
      const key = f.path       // which path exists on the compare side
      if (!key) return         // no path = deleted file, doesn't exist in compare
      const isRename = !!(f.old_path && f.old_path !== f.path)
      const status: DiffStatus = isRename ? 'renamed'
        : !f.old_path          ? 'added'    // new file — no base path
        : f.deletions === 0    ? 'added'
        : f.additions === 0    ? 'removed'
        : 'modified'
      if (!m.has(key)) m.set(key, { status, index: i })
    })
    return m
  }, [files])

  // ── Trees ─────────────────────────────────────────────────────────────────
  const baseTree = useMemo(() => {
    const s = new Set((baseFileList as FileEntry[]).map(f => f.path))
    // Add diff paths that exist on the base side (old_path present)
    files.forEach(f => { if (f.old_path) s.add(f.old_path) })
    return buildFileTree([...s], baseStatusMap)
  }, [baseFileList, baseStatusMap, files])

  const cmpTree = useMemo(() => {
    const s = new Set((cmpFileList as FileEntry[]).map(f => f.path))
    // Add diff paths that exist on the compare side (path present)
    files.forEach(f => { if (f.path) s.add(f.path) })
    return buildFileTree([...s], cmpStatusMap)
  }, [cmpFileList, cmpStatusMap, files])

  // ── Effects ───────────────────────────────────────────────────────────────
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

  useEffect(() => {
    setSelIdx(files.length > 0 ? 0 : null)
  }, [files])

  // ── Picker options ────────────────────────────────────────────────────────
  const rl      = refs as RefInfo[]
  const local   = rl.filter(r => r.kind === 'branch' && !r.ref.startsWith('origin/') && !r.ref.startsWith('remotes/'))
  const remote  = rl.filter(r => r.kind === 'branch' && (r.ref.startsWith('origin/') || r.ref.startsWith('remotes/')))
  const tags    = rl.filter(r => r.kind === 'tag')
  const commits = rl.filter(r => r.kind === 'commit')

  const simpleOptions: PickerOption[] = [
    ...local,  ...remote, ...tags, ...commits,
  ].map(r => ({ label: r.label, ref: r.ref, repoId: repoId!, repoName: 'this', kind: r.kind }))

  const arl        = allRefs as RefEntry[]
  const otherRefs  = arl.filter(r => r.repo_id !== repoId)
  const repoNameMap = new Map<string, string>([[repoId!, 'this']])
  otherRefs.forEach(r => {
    if (!repoNameMap.has(r.repo_id)) {
      repoNameMap.set(r.repo_id, r.label.split('/')[0])
    }
  })
  const crossOptions: PickerOption[] = arl.map(r => ({
    label: r.label, ref: r.ref, repoId: r.repo_id,
    repoName: repoNameMap.get(r.repo_id) ?? r.repo_id.slice(0, 8),
    kind: r.kind,
  }))

  // ── Render helpers ────────────────────────────────────────────────────────
  const curFile   = selIdx != null ? files[selIdx] : null
  const needsPick = !working && !(base || compare)

  const ExplorerPanel = ({
    label, color, tree, open, toggle, side, selectedPath, onSelectPath,
  }: {
    label: string; color: string; tree: FNode
    open: Set<string>; toggle: (p: string) => void
    side: 'left' | 'right'
    selectedPath?: string | null; onSelectPath?: (p: string) => void
  }) => (
    <div style={{
      width: 210, flexShrink: 0, display: 'flex', flexDirection: 'column',
      background: 'var(--bg-elevated)', overflow: 'hidden',
      borderRight: side === 'left'  ? '1px solid var(--border)' : undefined,
      borderLeft:  side === 'right' ? '1px solid var(--border)' : undefined,
    }}>
      <div style={{
        padding: '5px 8px', fontSize: 10, fontWeight: 700, color,
        letterSpacing: '0.07em', textTransform: 'uppercase',
        borderBottom: '1px solid var(--border)', flexShrink: 0,
        background: 'var(--bg-surface)',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>
        {label}
      </div>
      <div style={{ overflowY: 'auto', flex: 1, paddingTop: 4 }}>
        <FileTreeNode
          node={tree} depth={0} selIdx={pairMode ? null : selIdx}
          onSelect={setSelIdx} openDirs={open} toggleDir={toggle}
          selectedPath={selectedPath} onSelectPath={onSelectPath}
        />
      </div>
    </div>
  )

  // ── JSX ───────────────────────────────────────────────────────────────────
  return (
    <div style={{ padding: 24, height: '100%', display: 'flex', flexDirection: 'column' }}>
      <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 4 }}>Diff Viewer</h1>
      <p style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 14 }}>
        Compare branches, tags, commits — within or across repositories.
      </p>

      {/* Controls */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <button
          className={`btn btn-sm ${crossMode ? 'btn-primary' : 'btn-ghost'}`}
          onClick={() => {
            setCrossMode(c => !c)
            setBase(''); setCompare('')
            setBaseRepoId(repoId!); setCmpRepoId(repoId!)
          }}
        >
          <GitFork size={13} /> Cross-Repo
        </button>
        <div style={{ width: 1, height: 20, background: 'var(--border)' }} />

        {crossMode ? (
          <>
            <RefPicker
              options={crossOptions} value={base} repoIdVal={baseRepoId}
              onSelect={(ref, rid) => { setBase(ref); setBaseRepoId(rid || repoId!) }}
              placeholder="Base ref…" accentColor="var(--accent-red-hover)"
            />
            <button
              className="btn btn-ghost btn-icon"
              onClick={() => { setBase(compare); setCompare(base); setBaseRepoId(cmpRepoId); setCmpRepoId(baseRepoId) }}
            >
              <ArrowLeftRight size={14} />
            </button>
            <RefPicker
              options={crossOptions} value={compare} repoIdVal={cmpRepoId}
              onSelect={(ref, rid) => { setCompare(ref); setCmpRepoId(rid || repoId!) }}
              placeholder="Compare ref…" accentColor="var(--diff-add-text)"
            />
            <button className="btn btn-ghost btn-icon" onClick={() => refetchAll()} disabled={allRefsLoading}>
              <RefreshCw size={13} className={allRefsLoading ? 'spin' : ''} />
            </button>
          </>
        ) : (
          <>
            <RefPicker
              options={simpleOptions} value={base} repoIdVal={repoId!}
              onSelect={(ref) => setBase(ref)}
              placeholder="Base…" accentColor="var(--accent-red-hover)"
            />
            <button className="btn btn-ghost btn-icon" onClick={() => { setBase(compare); setCompare(base) }}>
              <ArrowLeftRight size={14} />
            </button>
            <RefPicker
              options={simpleOptions} value={compare} repoIdVal={repoId!}
              onSelect={(ref) => setCompare(ref)}
              placeholder="Compare…" accentColor="var(--diff-add-text)"
            />
            <button
              className={`btn btn-sm ${working ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => setWorking(w => !w)}
            >
              <Eye size={13} /> Working Tree
            </button>
            <button className="btn btn-ghost btn-icon" onClick={() => refetch()} disabled={refsLoading}>
              <RefreshCw size={13} className={refsLoading ? 'spin' : ''} />
            </button>
            <button
              className={`btn btn-sm ${debugMode ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => { setDebugMode(d => !d); if (!debugMode) setTimeout(() => refetchDebug(), 0) }}
            >
              <Bug size={13} /> Debug
            </button>
          </>
        )}

        {(totalAdd > 0 || totalDel > 0) && (
          <span style={{ marginLeft: 'auto', fontSize: 13 }}>
            <span style={{ color: 'var(--diff-add-text)' }}>+{totalAdd}</span>
            {' / '}
            <span style={{ color: 'var(--accent-red-hover)' }}>-{totalDel}</span>
            {' · '}{files.length} file{files.length !== 1 ? 's' : ''}
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

      {/* Main content */}
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
        <div style={{ display: 'flex', flex: 1, overflow: 'hidden', border: '1px solid var(--border)', borderRadius: 8, minHeight: 0 }}>

          {/* Left explorer — base */}
          <ExplorerPanel
            label={`Base · ${base || 'HEAD'}${baseRepoId !== repoId ? ' 📦' : ''}`}
            color="var(--accent-red-hover)"
            tree={baseTree} open={baseOpen} toggle={toggleBase} side="left"
            selectedPath={pairMode ? pairBase : null}
            onSelectPath={pairMode ? (p) => setPairBase(p) : undefined}
          />

          {/* Centre diff */}
          <div style={{ flex: 1, overflowY: 'auto', minWidth: 0 }}>
            {/* Pair mode toolbar */}
            {crossMode && (
              <div style={{
                padding: '5px 10px', background: 'var(--bg-surface)',
                borderBottom: '1px solid var(--border)',
                display: 'flex', alignItems: 'center', gap: 8, fontSize: 11,
                position: 'sticky', top: 0, zIndex: 3,
              }}>
                <button
                  className={`btn btn-sm ${pairMode ? 'btn-primary' : 'btn-ghost'}`}
                  onClick={() => { setPairMode(m => !m); setPairBase(null); setPairCmp(null); setSelIdx(files.length > 0 ? 0 : null) }}
                  title="Pick any file from each side to compare them directly">
                  <ArrowLeftRight size={12} /> Pick File Pair
                </button>
                {pairMode && (
                  <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>
                    {!pairBase && !pairCmp && 'Click a file on the left, then the right'}
                    {pairBase && !pairCmp && <><span style={{ color: 'var(--accent-red-hover)' }}>{pairBase}</span> → click a file on the right</>}
                    {pairBase && pairCmp && <><span style={{ color: 'var(--accent-red-hover)' }}>{pairBase}</span> ↔ <span style={{ color: 'var(--diff-add-text)' }}>{pairCmp}</span></>}
                  </span>
                )}
                {pairMode && (pairBase || pairCmp) && (
                  <button className="btn btn-ghost btn-sm" onClick={() => { setPairBase(null); setPairCmp(null) }}>✕ Clear</button>
                )}
              </div>
            )}

            {pairMode && pairBase && pairCmp ? (
              pairLoading ? (
                <div className="loading"><div className="spinner" /> Comparing files…</div>
              ) : pairDiffRaw ? (
                <>
                  <div style={{
                    padding: '6px 12px', background: 'var(--bg-surface)',
                    borderBottom: '1px solid var(--border)',
                    display: 'flex', alignItems: 'center', gap: 8,
                    position: 'sticky', top: crossMode ? 36 : 0, zIndex: 2,
                  }}>
                    <Code size={13} color="var(--text-muted)" />
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, flex: 1 }}>
                      <span style={{ color: 'var(--accent-red-hover)' }}>{pairBase}</span>
                      <span style={{ color: 'var(--text-muted)' }}> ↔ </span>
                      <span style={{ color: 'var(--diff-add-text)' }}>{pairCmp}</span>
                    </span>
                    <span style={{ color: 'var(--diff-add-text)', fontSize: 11 }}>+{(pairDiffRaw as DiffFile).additions}</span>
                    <span style={{ color: 'var(--accent-red-hover)', fontSize: 11, marginLeft: 4 }}>-{(pairDiffRaw as DiffFile).deletions}</span>
                  </div>
                  <SideBySide file={pairDiffRaw as DiffFile} />
                </>
              ) : null
            ) : files.length === 0 ? (
              <div className="empty-state" style={{ padding: 60 }}>
                <Code size={40} /><p>No differences between these refs</p>
                {crossMode && <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>Use "Pick File Pair" to compare specific files across repos</p>}
              </div>
            ) : !curFile ? (
              <div className="empty-state" style={{ padding: 40 }}>
                <FileX size={32} />
                <p>Select a highlighted file from either panel</p>
                <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>Dimmed files are unchanged — use "Pick File Pair" to compare any two files</p>
              </div>
            ) : (
              <>
                <div style={{
                  padding: '6px 12px', background: 'var(--bg-surface)',
                  borderBottom: '1px solid var(--border)',
                  display: 'flex', alignItems: 'center', gap: 8,
                  position: 'sticky', top: 0, zIndex: 2,
                }}>
                  <Code size={13} color="var(--text-muted)" />
                  <span style={{
                    fontFamily: 'var(--font-mono)', fontSize: 12, flex: 1,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>
                    {!curFile.old_path
                      ? <><span style={{ color: 'var(--diff-add-text)' }}>new</span> {curFile.path}</>
                      : !curFile.path
                        ? <>{curFile.old_path} <span style={{ color: 'var(--accent-red-hover)' }}>deleted</span></>
                        : curFile.old_path !== curFile.path
                          ? <>{curFile.old_path} <span style={{ color: 'var(--text-muted)' }}>→</span> {curFile.path}</>
                          : curFile.path}
                  </span>
                  <span style={{ color: 'var(--diff-add-text)', fontSize: 11 }}>+{curFile.additions}</span>
                  <span style={{ color: 'var(--accent-red-hover)', fontSize: 11, marginLeft: 4 }}>-{curFile.deletions}</span>
                  {curFile.is_binary && <span className="badge badge-yellow">binary</span>}
                  <button className="btn btn-ghost btn-sm" disabled={selIdx === 0}
                    onClick={() => setSelIdx(i => (i ?? 1) - 1)}>‹</button>
                  <button className="btn btn-ghost btn-sm" disabled={selIdx === files.length - 1}
                    onClick={() => setSelIdx(i => (i ?? 0) + 1)}>›</button>
                </div>
                {curFile.is_binary
                  ? <div className="empty-state" style={{ padding: 40 }}><File size={32} /><p>Binary file</p></div>
                  : <SideBySide file={curFile} />}
              </>
            )}
          </div>

          {/* Right explorer — compare */}
          <ExplorerPanel
            label={`Compare · ${compare || 'HEAD'}${cmpRepoId !== repoId ? ' 📦' : ''}`}
            color="var(--diff-add-text)"
            tree={cmpTree} open={cmpOpen} toggle={toggleCmp} side="right"
            selectedPath={pairMode ? pairCmp : null}
            onSelectPath={pairMode ? (p) => setPairCmp(p) : undefined}
          />
        </div>
      )}
    </div>
  )
}

// ─── Side-by-side diff ────────────────────────────────────────────────────────
function SideBySide({ file }: { file: DiffFile }) {
  type Row = { content: string; type: string; num: number | null }
  const L: Row[] = [], R: Row[] = []
  let lo = 0, ro = 0

  // Determine if this is a pure add (no base) or pure delete (no compare)
  const isNewFile     = !file.old_path   // created in compare, doesn't exist in base
  const isDeletedFile = !file.path       // deleted in compare, doesn't exist there

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
    t === 'added'   ? 'var(--diff-add-bg)' :
    t === 'header'  ? 'var(--diff-header-bg)' : 'transparent'
  const fg = (t: string) =>
    t === 'removed' ? 'var(--diff-remove-text)' :
    t === 'added'   ? 'var(--diff-add-text)' :
    t === 'header'  ? 'var(--text-muted)' : 'var(--text-primary)'

  const AbsentPanel = ({ label, side }: { label: string; side: 'base' | 'compare' }) => (
    <div style={{
      display: 'flex', flexDirection: 'column',
      borderRight: side === 'base' ? '1px solid var(--border)' : undefined,
    }}>
      <div style={{
        padding: '2px 8px', background: 'var(--bg-elevated)', fontSize: 11,
        color: 'var(--text-muted)', fontWeight: 600,
        borderBottom: '1px solid var(--border)',
        position: 'sticky', top: 0,
      }}>
        {label}
      </div>
      <div style={{
        flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: 'var(--text-muted)', fontSize: 12, fontStyle: 'italic',
        padding: 24, background: side === 'base' ? 'rgba(239,68,68,.04)' : 'rgba(34,197,94,.04)',
      }}>
        {side === 'base' ? '— file does not exist in base —' : '— file does not exist in compare —'}
      </div>
    </div>
  )

  const DiffPanel = ({ rows, fp, stat, isRight }: { rows: Row[]; fp: string; stat: React.ReactNode; isRight?: boolean }) => (
    <div style={{ overflow: 'auto', borderRight: !isRight ? '1px solid var(--border)' : undefined }}>
      <div style={{
        padding: '2px 8px', background: 'var(--bg-elevated)', fontSize: 11,
        color: 'var(--text-muted)', fontWeight: 600,
        borderBottom: '1px solid var(--border)',
        display: 'flex', gap: 8, position: 'sticky', top: 0,
      }}>
        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>{fp}</span>
        {stat}
      </div>
      {rows.map((row, i) => (
        <div key={i} style={{ display: 'flex', fontFamily: 'var(--font-mono)', fontSize: 12, minHeight: 20, background: bg(row.type) }}>
          <span style={{
            minWidth: 38, padding: '0 5px', textAlign: 'right',
            color: 'var(--text-muted)', borderRight: '1px solid var(--border-muted)',
            fontSize: 11, userSelect: 'none', flexShrink: 0,
          }}>
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
        : <DiffPanel rows={L} fp={baseFp}    stat={<span style={{ color: 'var(--accent-red-hover)' }}>-{file.deletions}</span>} />}
      {isDeletedFile
        ? <AbsentPanel label={`${baseFp} → (deleted)`} side="compare" />
        : <DiffPanel rows={R} fp={compareFp} stat={<span style={{ color: 'var(--diff-add-text)'   }}>+{file.additions}</span>} isRight />}
    </div>
  )
}
