import { useState, useRef, useCallback } from 'react'
import { useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'react-hot-toast'
import { AlertTriangle, Check, ChevronRight, ChevronLeft, RefreshCw, RotateCcw, GripVertical } from 'lucide-react'
import { getConflicts, resolveConflict } from '../utils/api'
import { ConflictFile } from '../types'

// ─── Types ───────────────────────────────────────────────────────────────────

type Side = 'ours' | 'theirs'

interface DraggableLine {
  id: string       // unique key for React
  text: string
  side: Side
  originalIndex: number
}

interface ResolutionLine {
  id: string
  text: string
  side: Side | 'manual'
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeId() {
  return Math.random().toString(36).slice(2)
}

function buildDefaultResolution(file: ConflictFile): ResolutionLine[] {
  return [
    ...file.base_lines,
    '<<<<<<< OURS',
    ...file.our_lines,
    '=======',
    ...file.their_lines,
    '>>>>>>> THEIRS',
  ].map(text => ({ id: makeId(), text, side: 'manual' as const }))
}

function resolutionToString(lines: ResolutionLine[]) {
  return lines.map(l => l.text).join('\n')
}

// ─── SelectablePanel ─────────────────────────────────────────────────────────

interface SelectablePanelProps {
  title: string
  lines: string[]
  side: Side
  bgColor: string
  textColor: string
  onAcceptAll: () => void
  onDropLines: (lines: DraggableLine[]) => void
}

function SelectablePanel({ title, lines, side, bgColor, textColor, onAcceptAll, onDropLines }: SelectablePanelProps) {
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [lastClicked, setLastClicked] = useState<number | null>(null)
  const [dragging, setDragging] = useState(false)
  const [dropOver, setDropOver] = useState(false)

  const handleLineClick = useCallback((idx: number, e: React.MouseEvent) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (e.shiftKey && lastClicked !== null) {
        // Range select
        const lo = Math.min(lastClicked, idx)
        const hi = Math.max(lastClicked, idx)
        for (let i = lo; i <= hi; i++) next.add(i)
      } else if (e.ctrlKey || e.metaKey) {
        // Toggle
        if (next.has(idx)) next.delete(idx); else next.add(idx)
      } else {
        // Single click: if already selected alone, deselect; else select only this
        if (next.size === 1 && next.has(idx)) {
          next.clear()
        } else {
          next.clear()
          next.add(idx)
        }
      }
      return next
    })
    setLastClicked(idx)
  }, [lastClicked])

  const getDraggableLines = useCallback((): DraggableLine[] => {
    const idxs = selected.size > 0 ? Array.from(selected).sort((a: unknown, b: unknown) => (a as number) - (b as number)) : []
    return (idxs as number[]).map((i: number) => ({ id: makeId(), text: lines[i], side, originalIndex: i }))
  }, [selected, lines, side])

  // Drag from this panel → resolution
  const handleDragStart = useCallback((e: React.DragEvent) => {
    if (selected.size === 0) { e.preventDefault(); return }
    const payload = getDraggableLines()
    e.dataTransfer.setData('application/conflict-lines', JSON.stringify(payload))
    e.dataTransfer.effectAllowed = 'copy'
    setDragging(true)
  }, [selected, getDraggableLines])

  const handleDragEnd = useCallback(() => {
    setDragging(false)
  }, [])

  // Drop INTO this panel: select those lines (reverse direction, for reset visual)
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
    setDropOver(true)
  }, [])
  const handleDragLeave = useCallback(() => setDropOver(false), [])
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDropOver(false)
    // We don't actually need to do anything here — drops go to the resolution
  }, [])

  return (
    <div
      style={{
        background: bgColor,
        border: `1px solid ${dropOver ? 'var(--accent-blue)' : 'var(--border)'}`,
        borderRadius: 'var(--radius-sm)',
        overflow: 'hidden',
        opacity: dragging ? 0.7 : 1,
        transition: 'opacity 0.15s, border-color 0.15s',
      }}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div style={{ padding: '6px 10px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6 }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: textColor }}>{title}</span>
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          {selected.size > 0 && (
            <span style={{ fontSize: 11, color: 'var(--text-muted)', marginRight: 4 }}>
              {selected.size} line{selected.size !== 1 ? 's' : ''} selected
            </span>
          )}
          <button className="btn btn-ghost" style={{ fontSize: 11, padding: '2px 8px' }} onClick={onAcceptAll}>Use All</button>
        </div>
      </div>

      <div
        draggable={selected.size > 0}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        style={{ padding: 4, maxHeight: 240, overflow: 'auto', cursor: selected.size > 0 ? 'grab' : 'default' }}
        title={selected.size > 0 ? 'Drag selected lines to resolution' : ''}
      >
        {lines.length === 0 ? (
          <span style={{ color: 'var(--text-muted)', fontSize: 12, fontStyle: 'italic', padding: 8, display: 'block' }}>(empty)</span>
        ) : lines.map((line, i) => {
          const isSelected = selected.has(i)
          return (
            <div
              key={i}
              onClick={e => handleLineClick(i, e)}
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 12,
                color: isSelected ? '#fff' : textColor,
                lineHeight: 1.6,
                whiteSpace: 'pre-wrap',
                padding: '1px 6px',
                borderRadius: 2,
                userSelect: 'none',
                cursor: 'pointer',
                background: isSelected ? 'var(--accent-blue)' : 'transparent',
                display: 'flex',
                alignItems: 'flex-start',
                gap: 4,
              }}
            >
              <span style={{ color: isSelected ? '#adf' : 'var(--text-muted)', fontSize: 10, minWidth: 24, textAlign: 'right', paddingTop: 2, flexShrink: 0 }}>{i + 1}</span>
              <span style={{ flex: 1 }}>{line || '\u00A0'}</span>
              {isSelected && <GripVertical size={11} style={{ flexShrink: 0, marginTop: 3, opacity: 0.6 }} />}
            </div>
          )
        })}
      </div>

      {selected.size > 0 && (
        <div style={{ padding: '4px 8px', borderTop: '1px solid var(--border)', fontSize: 11, color: 'var(--text-muted)' }}>
          Drag to resolution ↓ · Click to deselect · Shift+click for range
        </div>
      )}
    </div>
  )
}

// ─── ResolutionEditor ─────────────────────────────────────────────────────────

interface ResolutionEditorProps {
  lines: ResolutionLine[]
  onChange: (lines: ResolutionLine[]) => void
}

function ResolutionEditor({ lines, onChange }: ResolutionEditorProps) {
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [lastClicked, setLastClicked] = useState<number | null>(null)

  const handleDragOver = useCallback((e: React.DragEvent, idx: number) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
    setDragOverIdx(idx)
  }, [])

  const handleDragLeave = useCallback(() => setDragOverIdx(null), [])

  const handleDrop = useCallback((e: React.DragEvent, insertBefore: number) => {
    e.preventDefault()
    setDragOverIdx(null)
    const raw = e.dataTransfer.getData('application/conflict-lines')
    if (!raw) return
    const incoming: DraggableLine[] = JSON.parse(raw)
    const newLines: ResolutionLine[] = incoming.map(dl => ({
      id: makeId(),
      text: dl.text,
      side: dl.side,
    }))
    const next = [...lines]
    next.splice(insertBefore, 0, ...newLines)
    onChange(next)
    toast.success(`Added ${newLines.length} line${newLines.length !== 1 ? 's' : ''}`)
  }, [lines, onChange])

  const handleLineClick = useCallback((idx: number, e: React.MouseEvent) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (e.shiftKey && lastClicked !== null) {
        const lo = Math.min(lastClicked, idx)
        const hi = Math.max(lastClicked, idx)
        for (let i = lo; i <= hi; i++) next.add(i)
      } else if (e.ctrlKey || e.metaKey) {
        if (next.has(idx)) next.delete(idx); else next.add(idx)
      } else {
        if (next.size === 1 && next.has(idx)) next.clear()
        else { next.clear(); next.add(idx) }
      }
      return next
    })
    setLastClicked(idx)
  }, [lastClicked])

  const removeSelected = useCallback(() => {
    const next = lines.filter((_, i) => !selected.has(i))
    onChange(next)
    setSelected(new Set())
    toast.success('Removed selected lines')
  }, [lines, selected, onChange])

  const textValue = lines.map(l => l.text).join('\n')

  const handleTextChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newText = e.target.value
    const newLines: ResolutionLine[] = newText.split('\n').map(text => ({
      id: makeId(),
      text,
      side: 'manual' as const,
    }))
    onChange(newLines)
  }, [onChange])

  const getSideColor = (side: Side | 'manual') => {
    if (side === 'ours') return 'var(--diff-add-line)'
    if (side === 'theirs') return 'var(--diff-remove-line)'
    return 'transparent'
  }

  const getSideLabel = (side: Side | 'manual') => {
    if (side === 'ours') return '◀'
    if (side === 'theirs') return '▶'
    return ''
  }

  return (
    <div className="card">
      <div className="card-header">
        <span style={{ fontWeight: 600, fontSize: 13 }}>✏️ Resolution</span>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {selected.size > 0 && (
            <button className="btn btn-ghost btn-sm" style={{ color: 'var(--accent-red)' }} onClick={removeSelected}>
              Remove {selected.size} line{selected.size !== 1 ? 's' : ''}
            </button>
          )}
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Drop lines here · Click to select · Del to remove</span>
        </div>
      </div>

      {/* Visual line-by-line drop zone */}
      <div style={{ maxHeight: 300, overflow: 'auto', borderBottom: '1px solid var(--border)' }}>
        {/* Drop zone at the very top */}
        <DropZone
          isOver={dragOverIdx === -1}
          onDragOver={e => handleDragOver(e, 0)}
          onDragLeave={handleDragLeave}
          onDrop={e => handleDrop(e, 0)}
        />

        {lines.map((line, i) => (
          <div key={line.id}>
            <div
              onClick={e => handleLineClick(i, e)}
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 4,
                padding: '1px 8px',
                background: selected.has(i)
                  ? 'var(--accent-blue)'
                  : getSideColor(line.side),
                cursor: 'pointer',
                userSelect: 'none',
                borderLeft: `3px solid ${
                  line.side === 'ours' ? 'var(--diff-add-text)' :
                  line.side === 'theirs' ? 'var(--diff-remove-text)' :
                  'transparent'
                }`,
              }}
            >
              <span style={{ color: 'var(--text-muted)', fontSize: 10, minWidth: 24, textAlign: 'right', paddingTop: 2, flexShrink: 0 }}>{i + 1}</span>
              <span style={{ fontSize: 10, minWidth: 12, color: selected.has(i) ? '#adf' : 'var(--text-muted)', flexShrink: 0 }}>{getSideLabel(line.side)}</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: selected.has(i) ? '#fff' : 'var(--text-primary)', flex: 1, whiteSpace: 'pre-wrap' }}>
                {line.text || '\u00A0'}
              </span>
            </div>
            <DropZone
              isOver={dragOverIdx === i + 1}
              onDragOver={e => handleDragOver(e, i + 1)}
              onDragLeave={handleDragLeave}
              onDrop={e => handleDrop(e, i + 1)}
            />
          </div>
        ))}

        {lines.length === 0 && (
          <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
            Drop lines from the panels above, or type below
          </div>
        )}
      </div>

      {/* Also allow raw text editing */}
      <textarea
        value={textValue}
        onChange={handleTextChange}
        placeholder="Or type/paste your resolution here directly…"
        style={{
          width: '100%',
          minHeight: 120,
          background: 'var(--bg-base)',
          color: 'var(--text-primary)',
          border: 'none',
          padding: 12,
          fontFamily: 'var(--font-mono)',
          fontSize: 12,
          resize: 'vertical',
          outline: 'none',
        }}
        spellCheck={false}
      />
    </div>
  )
}

function DropZone({ isOver, onDragOver, onDragLeave, onDrop }: {
  isOver: boolean
  onDragOver: (e: React.DragEvent) => void
  onDragLeave: () => void
  onDrop: (e: React.DragEvent) => void
}) {
  return (
    <div
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      style={{
        height: isOver ? 28 : 4,
        background: isOver ? 'var(--accent-blue)' : 'transparent',
        borderRadius: 2,
        transition: 'height 0.1s, background 0.1s',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
      }}
    >
      {isOver && (
        <span style={{ fontSize: 11, color: '#fff', fontWeight: 600 }}>Drop here</span>
      )}
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function ConflictsPage() {
  const { repoId } = useParams<{ repoId: string }>()
  const qc = useQueryClient()
  const [activeFile, setActiveFile] = useState(0)
  const [resolutions, setResolutions] = useState<Record<string, ResolutionLine[]>>({})
  const [saving, setSaving] = useState(false)

  const { data: conflicts = [], isLoading, refetch } = useQuery<ConflictFile[]>({
    queryKey: ['conflicts', repoId],
    queryFn: () => getConflicts(repoId!),
  })

  const current = (conflicts as ConflictFile[])[activeFile]

  const initResolution = (file: ConflictFile) => {
    if (!resolutions[file.path]) {
      setResolutions(r => ({ ...r, [file.path]: buildDefaultResolution(file) }))
    }
  }

  const getResolution = (file: ConflictFile): ResolutionLine[] => {
    return resolutions[file.path] ?? buildDefaultResolution(file)
  }

  const setResolution = (file: ConflictFile, lines: ResolutionLine[]) => {
    setResolutions(r => ({ ...r, [file.path]: lines }))
  }

  const resetResolution = (file: ConflictFile) => {
    setResolutions(r => ({ ...r, [file.path]: buildDefaultResolution(file) }))
    toast.success('Reset to original conflict markers')
  }

  const acceptOurs = (file: ConflictFile) => {
    setResolutions(r => ({
      ...r,
      [file.path]: file.our_lines.map(text => ({ id: makeId(), text, side: 'ours' as const }))
    }))
    toast.success('Accepted our changes')
  }

  const acceptTheirs = (file: ConflictFile) => {
    setResolutions(r => ({
      ...r,
      [file.path]: file.their_lines.map(text => ({ id: makeId(), text, side: 'theirs' as const }))
    }))
    toast.success('Accepted their changes')
  }

  const acceptBoth = (file: ConflictFile) => {
    setResolutions(r => ({
      ...r,
      [file.path]: [
        ...file.our_lines.map(text => ({ id: makeId(), text, side: 'ours' as const })),
        ...file.their_lines.map(text => ({ id: makeId(), text, side: 'theirs' as const })),
      ]
    }))
    toast.success('Accepted both changes')
  }

  const saveResolution = async (file: ConflictFile) => {
    const lines = getResolution(file)
    const content = resolutionToString(lines)
    setSaving(true)
    try {
      await resolveConflict(repoId!, { path: file.path, content })
      toast.success(`Resolved: ${file.path}`)
      refetch()
    } catch {
      toast.error('Failed to save resolution')
    } finally { setSaving(false) }
  }

  if (isLoading) return <div className="loading" style={{ padding: 40 }}><div className="spinner" /> Checking for conflicts…</div>

  if ((conflicts as ConflictFile[]).length === 0) return (
    <div style={{ padding: 24 }}>
      <div className="empty-state">
        <Check size={48} color="var(--diff-add-text)" />
        <div>
          <p style={{ fontWeight: 600 }}>No conflicts detected</p>
          <p style={{ fontSize: 13 }}>Everything looks clean. You can proceed with your merge or rebase.</p>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={() => refetch()}><RefreshCw size={13} /> Check again</button>
      </div>
    </div>
  )

  return (
    <div style={{ padding: 24 }}>
      <div style={{ marginBottom: 16 }}>
        <h1 style={{ fontSize: 20, fontWeight: 700 }}>Conflict Resolver</h1>
        <p style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 2 }}>
          Click to select lines · Shift+click for ranges · Drag selected lines to resolution · Reset to start over.
        </p>
      </div>

      <div className="banner banner-warn" style={{ marginBottom: 16 }}>
        <AlertTriangle size={15} />
        <span><strong>{(conflicts as ConflictFile[]).length} file(s) with conflicts.</strong> Resolve each one, then go to Merge/Rebase → Continue.</span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '220px 1fr', gap: 16 }}>
        {/* File list */}
        <div className="card" style={{ overflow: 'auto', maxHeight: 600 }}>
          <div className="card-header" style={{ padding: '10px 12px' }}>
            <span style={{ fontWeight: 600, fontSize: 13 }}>Conflicting Files</span>
          </div>
          {(conflicts as ConflictFile[]).map((f, i) => (
            <div key={f.path} onClick={() => { setActiveFile(i); initResolution(f) }}
              style={{ padding: '8px 12px', cursor: 'pointer', borderBottom: '1px solid var(--border-muted)', background: i === activeFile ? 'var(--bg-hover)' : 'transparent', borderLeft: i === activeFile ? '2px solid var(--accent-blue)' : '2px solid transparent', display: 'flex', alignItems: 'center', gap: 8 }}>
              <AlertTriangle size={13} color={resolutions[f.path] ? 'var(--diff-add-text)' : 'var(--accent-yellow)'} />
              <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.path}</span>
              {resolutions[f.path] && <Check size={12} color="var(--diff-add-text)" />}
            </div>
          ))}
        </div>

        {/* Resolver */}
        {current ? (
          <div>
            {/* Action bar */}
            <div style={{ marginBottom: 12, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--text-secondary)', flex: 1 }}>{current.path}</span>
              <button className="btn btn-ghost btn-sm" onClick={() => acceptOurs(current)}>
                <ChevronLeft size={13} /> Accept Ours
              </button>
              <button className="btn btn-ghost btn-sm" onClick={() => acceptBoth(current)}>
                Accept Both
              </button>
              <button className="btn btn-ghost btn-sm" onClick={() => acceptTheirs(current)}>
                Accept Theirs <ChevronRight size={13} />
              </button>
              <button className="btn btn-ghost btn-sm" onClick={() => resetResolution(current)} title="Reset to original conflict markers">
                <RotateCcw size={13} /> Reset
              </button>
              <button className="btn btn-success btn-sm" onClick={() => saveResolution(current)} disabled={saving}>
                <Check size={12} /> {saving ? 'Saving…' : 'Mark Resolved'}
              </button>
            </div>

            {/* 3-way diff panels (selectable + draggable) */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 12 }}>
              <SelectablePanel
                title="⬅ Our Changes (HEAD)"
                lines={current.our_lines}
                side="ours"
                bgColor="var(--diff-add-bg)"
                textColor="var(--diff-add-text)"
                onAcceptAll={() => acceptOurs(current)}
                onDropLines={() => {}}
              />
              {/* Base panel (read-only, no drag) */}
              <BasePanel lines={current.base_lines} />
              <SelectablePanel
                title="Incoming Changes ➡"
                lines={current.their_lines}
                side="theirs"
                bgColor="var(--diff-remove-bg)"
                textColor="var(--accent-yellow)"
                onAcceptAll={() => acceptTheirs(current)}
                onDropLines={() => {}}
              />
            </div>

            {/* Resolution drop target + editor */}
            <ResolutionEditor
              lines={getResolution(current)}
              onChange={lines => setResolution(current, lines)}
            />
          </div>
        ) : (
          <div className="empty-state">Select a conflicting file to resolve it</div>
        )}
      </div>
    </div>
  )
}

function BasePanel({ lines }: { lines: string[] }) {
  return (
    <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', overflow: 'hidden' }}>
      <div style={{ padding: '6px 10px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)' }}>📄 Base (Common Ancestor)</span>
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>read-only</span>
      </div>
      <div style={{ padding: 4, maxHeight: 240, overflow: 'auto' }}>
        {lines.length === 0 ? (
          <span style={{ color: 'var(--text-muted)', fontSize: 12, fontStyle: 'italic', padding: 8, display: 'block' }}>(empty)</span>
        ) : lines.map((line, i) => (
          <div key={i} style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.6, padding: '1px 6px', display: 'flex', gap: 4 }}>
            <span style={{ color: 'var(--text-muted)', fontSize: 10, minWidth: 24, textAlign: 'right', paddingTop: 2, flexShrink: 0 }}>{i + 1}</span>
            <span>{line || '\u00A0'}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
