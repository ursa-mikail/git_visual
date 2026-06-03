import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Eye, Search, FileText } from 'lucide-react'
import { getBlame, getFileTree } from '../utils/api'
import { BlameInfo } from '../types'

export default function BlamePage() {
  const { repoId } = useParams<{ repoId: string }>()
  const [selectedFile, setSelectedFile] = useState('')
  const [ref, setRef] = useState('')
  const [search, setSearch] = useState('')

  const { data: fileTree = [] } = useQuery<{ path: string }[]>({
    queryKey: ['filetree', repoId],
    queryFn: () => getFileTree(repoId!),
  })

  const { data: blame = [], isLoading } = useQuery<BlameInfo[]>({
    queryKey: ['blame', repoId, selectedFile, ref],
    queryFn: () => getBlame(repoId!, selectedFile, ref || undefined),
    enabled: !!selectedFile,
  })

  const filtered = (blame as BlameInfo[]).filter((b: BlameInfo) =>
    !search || b.content.toLowerCase().includes(search.toLowerCase()) || b.author.toLowerCase().includes(search.toLowerCase())
  )

  // Color authors consistently
  const authorColors: Record<string, string> = {}
  const palette = ['var(--accent-blue)', 'var(--accent-green)', 'var(--accent-orange)', 'var(--accent-purple)', 'var(--accent-teal)', 'var(--accent-yellow)']
  let colorIdx = 0
  ;(blame as BlameInfo[]).forEach((b: BlameInfo) => {
    if (!authorColors[b.author]) {
      authorColors[b.author] = palette[colorIdx % palette.length]
      colorIdx++
    }
  })

  return (
    <div style={{ padding: 24 }}>
      <div style={{ marginBottom: 16 }}>
        <h1 style={{ fontSize: 20, fontWeight: 700 }}>Git Blame</h1>
        <p style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 2 }}>
          See who wrote each line of code, when, and in which commit. No more detective work.
        </p>
      </div>

      <div className="guide-tip" style={{ marginBottom: 16 }}>
        <Eye size={15} style={{ flexShrink: 0, color: 'var(--text-link)' }} />
        <div>
          <strong>Blame</strong> annotates every line of a file with who last changed it and when.
          Each author gets a unique color. Hover over a hash to see the commit message.
          Equivalent to <code>git blame --line-porcelain</code>.
        </div>
      </div>

      <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
        <select value={selectedFile} onChange={e => setSelectedFile(e.target.value)} style={{ minWidth: 280, maxWidth: 400 }}>
          <option value="">Select a file…</option>
          {(fileTree as { path: string }[]).map((f: { path: string }) => (
            <option key={f.path} value={f.path}>{f.path}</option>
          ))}
        </select>
        <input value={ref} onChange={e => setRef(e.target.value)} placeholder="Ref / branch (blank = HEAD)" style={{ width: 200 }} />
        <div style={{ position: 'relative' }}>
          <Search size={13} style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }} />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Filter lines…" style={{ paddingLeft: 28, width: 200 }} />
        </div>
      </div>

      {!selectedFile ? (
        <div className="empty-state">
          <FileText size={48} />
          <p>Select a file to see its blame</p>
        </div>
      ) : isLoading ? (
        <div className="loading"><div className="spinner" /> Loading blame…</div>
      ) : filtered.length === 0 ? (
        <div className="empty-state"><p>No results</p></div>
      ) : (
        <>
          {/* Author legend */}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
            {Object.entries(authorColors).map(([author, color]) => (
              <span key={author} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12 }}>
                <span style={{ width: 10, height: 10, borderRadius: '50%', background: color, flexShrink: 0 }} />
                {author}
              </span>
            ))}
          </div>

          <div className="card" style={{ overflow: 'auto', maxHeight: 620 }}>
            {filtered.map((b: BlameInfo, i: number) => (
              <div key={i} style={{ display: 'grid', gridTemplateColumns: '8px 70px 120px 90px 1fr', alignItems: 'stretch', borderBottom: '1px solid var(--border-muted)', fontSize: 12, fontFamily: 'var(--font-mono)', minHeight: 22 }}>
                {/* Author color bar */}
                <div style={{ background: authorColors[b.author], opacity: 0.7 }} title={b.author} />
                {/* Hash */}
                <div style={{ padding: '2px 6px', color: 'var(--accent-blue)', display: 'flex', alignItems: 'center' }} title={`Commit ${b.hash}`}>
                  {b.hash.slice(0, 7)}
                </div>
                {/* Author */}
                <div style={{ padding: '2px 6px', color: authorColors[b.author], display: 'flex', alignItems: 'center', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {b.author}
                </div>
                {/* Date */}
                <div style={{ padding: '2px 6px', color: 'var(--text-muted)', display: 'flex', alignItems: 'center' }}>
                  {b.date}
                </div>
                {/* Content */}
                <div style={{ padding: '2px 8px', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', whiteSpace: 'pre', overflow: 'hidden' }}>
                  <span style={{ color: 'var(--text-muted)', marginRight: 12, userSelect: 'none', minWidth: 30, textAlign: 'right' }}>{b.line_num}</span>
                  {b.content}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
