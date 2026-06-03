import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { History, ChevronLeft, ChevronRight } from 'lucide-react'
import { getAudit } from '../utils/api'
import { PaginatedResult } from '../types'

interface AuditEntry { id: string; repo_id?: string; action: string; details: string; created_at: string }

export default function AuditPage() {
  const [page, setPage] = useState(1)
  const pageSize = 25

  const { data } = useQuery<PaginatedResult<AuditEntry>>({
    queryKey: ['audit', page],
    queryFn: () => getAudit(page, pageSize),
    refetchInterval: 10000,
  })

  const entries: AuditEntry[] = data?.data || []
  const total = data?.total || 0
  const totalPages = data?.total_pages || 1

  const actionColor = (action: string) => {
    if (action.includes('delete') || action.includes('close')) return 'badge-red'
    if (action.includes('create') || action.includes('merge')) return 'badge-green'
    if (action.includes('push') || action.includes('pull')) return 'badge-blue'
    return 'badge-gray'
  }

  return (
    <div style={{ padding: 24 }}>
      <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 4 }}>Audit Log</h1>
      <p style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 20 }}>
        Every git operation performed in GitVisual — who did what, when.
      </p>

      {entries.length === 0 ? (
        <div className="empty-state"><History size={48} /><p>No audit entries yet</p></div>
      ) : (
        <>
          <div className="card">
            {entries.map((e: AuditEntry, i: number) => {
              let details: Record<string, unknown> = {}
              try { details = JSON.parse(e.details) } catch {}
              return (
                <div key={e.id} style={{ padding: '10px 16px', borderBottom: i < entries.length - 1 ? '1px solid var(--border-muted)' : 'none', display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                  <History size={14} color="var(--text-muted)" style={{ marginTop: 3, flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
                      <span className={`badge ${actionColor(e.action)}`}>{e.action}</span>
                      <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                        {Object.entries(details).map(([k, v]) => `${k}: ${v}`).join(' · ')}
                      </span>
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                      {new Date(e.created_at).toLocaleString()}
                      {e.repo_id && <span> · repo: {e.repo_id.slice(0, 8)}</span>}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 16 }}>
            <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>{total} total entries</span>
            <div style={{ display: 'flex', gap: 6 }}>
              <button className="btn btn-ghost btn-sm" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1}><ChevronLeft size={14} /></button>
              <span style={{ padding: '4px 12px', fontSize: 13, color: 'var(--text-secondary)' }}>{page}/{totalPages}</span>
              <button className="btn btn-ghost btn-sm" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages}><ChevronRight size={14} /></button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
