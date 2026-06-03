import { useState, useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import { toast } from 'react-hot-toast'
import { Database, Download, Upload, Search, ChevronLeft, ChevronRight, RefreshCw, Table } from 'lucide-react'
import { getSchema, getTableData, exportCSV } from '../utils/api'
import { TableSchema, PaginatedResult } from '../types'

export default function SchemaPage() {
  const [activeTable, setActiveTable] = useState('repositories')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')

  const debounceRef = useState<ReturnType<typeof setTimeout>>(null as unknown as ReturnType<typeof setTimeout>)[0]

  const handleSearch = useCallback((val: string) => {
    setSearch(val)
    clearTimeout(debounceRef)
    const t = setTimeout(() => { setDebouncedSearch(val); setPage(1) }, 350)
    ;(window as unknown as { _searchDebounce: ReturnType<typeof setTimeout> })._searchDebounce = t
  }, [])

  const { data: schemas = [], isLoading: schemaLoading } = useQuery<TableSchema[]>({
    queryKey: ['schema'],
    queryFn: getSchema,
  })

  const { data: tableData, isLoading: dataLoading, refetch } = useQuery<PaginatedResult<Record<string, unknown>>>({
    queryKey: ['tabledata', activeTable, page, pageSize, debouncedSearch],
    queryFn: () => getTableData(activeTable, page, pageSize, debouncedSearch || undefined),
    enabled: !!activeTable,
  })

  const rows: Record<string, unknown>[] = tableData?.data || []
  const total = tableData?.total || 0
  const totalPages = tableData?.total_pages || 1

  const activeSchema = (schemas as TableSchema[]).find((s: TableSchema) => s.table_name === activeTable)

  const handleExport = async () => {
    try {
      const blob = await exportCSV(activeTable)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url; a.download = `${activeTable}.csv`; a.click()
      URL.revokeObjectURL(url)
      toast.success(`Exported ${activeTable}.csv`)
    } catch { toast.error('Export failed') }
  }

  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 700 }}>Database Explorer</h1>
          <p style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 2 }}>
            Browse all GitVisual data. Search, paginate, and export any table as CSV.
          </p>
        </div>
        <button className="btn btn-ghost" onClick={() => refetch()}><RefreshCw size={13} /> Refresh</button>
      </div>

      <div className="guide-tip" style={{ marginBottom: 16 }}>
        <Database size={15} style={{ flexShrink: 0, color: 'var(--text-link)' }} />
        <div>
          The DB Explorer shows live data from GitVisual's PostgreSQL database. Use it to inspect, search, and export any data.
          Search is real-time and auto-completes as you type — backed by the API's live database query.
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '200px 1fr', gap: 16 }}>
        {/* Table list */}
        <div className="card" style={{ overflow: 'auto' }}>
          <div className="card-header" style={{ padding: '10px 12px' }}>
            <span style={{ fontWeight: 600, fontSize: 13 }}>Tables</span>
          </div>
          {schemaLoading ? (
            <div className="loading" style={{ padding: 20 }}><div className="spinner" /></div>
          ) : (schemas as TableSchema[]).map((s: TableSchema) => (
            <div key={s.table_name} onClick={() => { setActiveTable(s.table_name); setPage(1); setSearch(''); setDebouncedSearch('') }}
              style={{ padding: '8px 12px', cursor: 'pointer', borderBottom: '1px solid var(--border-muted)', background: activeTable === s.table_name ? 'var(--bg-hover)' : 'transparent', borderLeft: activeTable === s.table_name ? '2px solid var(--accent-blue)' : '2px solid transparent' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
                <Table size={13} color={activeTable === s.table_name ? 'var(--accent-blue)' : 'var(--text-muted)'} />
                <span style={{ flex: 1 }}>{s.table_name}</span>
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{s.row_count}</span>
              </div>
            </div>
          ))}
        </div>

        {/* Data view */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
          {/* Schema */}
          {activeSchema && (
            <div className="card" style={{ padding: 12 }}>
              <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>Schema: {activeSchema.table_name}</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {activeSchema.columns.map(col => (
                  <span key={col.name} className="tag" style={{ fontSize: 11 }}>
                    <span style={{ color: 'var(--accent-blue)' }}>{col.name}</span>
                    <span style={{ color: 'var(--text-muted)', marginLeft: 4 }}>{col.data_type}</span>
                    {col.nullable === 'NO' && <span style={{ color: 'var(--accent-red-hover)', marginLeft: 3 }}>*</span>}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Controls */}
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{ position: 'relative', flex: 1, minWidth: 200 }}>
              <Search size={13} style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }} />
              <input value={search} onChange={e => handleSearch(e.target.value)}
                placeholder={`Search ${activeTable}… (auto-complete)`}
                style={{ width: '100%', paddingLeft: 28 }} />
            </div>
            <select value={pageSize} onChange={e => { setPageSize(Number(e.target.value)); setPage(1) }}>
              <option value={10}>10/page</option>
              <option value={20}>20/page</option>
              <option value={50}>50/page</option>
              <option value={100}>100/page</option>
            </select>
            <button className="btn btn-ghost btn-sm" onClick={handleExport}>
              <Download size={13} /> Export CSV
            </button>
          </div>

          {/* Table */}
          {dataLoading ? (
            <div className="loading" style={{ minHeight: 200 }}><div className="spinner" /> Loading…</div>
          ) : rows.length === 0 ? (
            <div className="empty-state" style={{ minHeight: 200 }}>
              <Database size={40} />
              <p>No data{search ? ` matching "${search}"` : ''}</p>
            </div>
          ) : (
            <div className="card" style={{ overflow: 'auto' }}>
              <table>
                <thead>
                  <tr>
                    {Object.keys(rows[0]).map(col => (
                      <th key={col}>{col}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, i) => (
                    <tr key={i}>
                      {Object.values(row).map((val, j) => (
                        <td key={j} style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {val === null || val === undefined ? (
                            <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>null</span>
                          ) : typeof val === 'boolean' ? (
                            <span className={`badge ${val ? 'badge-green' : 'badge-gray'}`}>{String(val)}</span>
                          ) : String(val).length > 60 ? (
                            <span title={String(val)}>{String(val).slice(0, 60)}…</span>
                          ) : (
                            String(val)
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Pagination */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>
              {total} total rows · page {page}/{totalPages}
            </span>
            <div style={{ display: 'flex', gap: 6 }}>
              <button className="btn btn-ghost btn-sm" onClick={() => setPage(1)} disabled={page <= 1}>«</button>
              <button className="btn btn-ghost btn-sm" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1}>
                <ChevronLeft size={14} />
              </button>
              <button className="btn btn-ghost btn-sm" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages}>
                <ChevronRight size={14} />
              </button>
              <button className="btn btn-ghost btn-sm" onClick={() => setPage(totalPages)} disabled={page >= totalPages}>»</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
