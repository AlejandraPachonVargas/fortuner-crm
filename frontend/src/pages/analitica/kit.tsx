import { useQuery } from '@tanstack/react-query'
import clsx from 'clsx'
import { BarChart3, Download, Info, Table2 } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { ErrorBox, Skeleton } from '@/components/ui'
import { api, ApiError } from '@/lib/api'
import { fmtV, type Fmt } from '@/charts/builders'

/** Carga un tablero. Reintenta solo mientras el servidor responde 503 (la lista de clientes del ERP se está cargando). */
export function useTablero<T>(path: string) {
  return useQuery<T, ApiError>({
    queryKey: [path], queryFn: () => api<T>(path), staleTime: 120_000, placeholderData: (prev) => prev,
    retry: (n, e) => e instanceof ApiError && e.status === 503 && n < 12, retryDelay: 4000,
  })
}

/** Arma la consulta con los filtros que tengan valores (listas separadas por coma). */
export function consulta(f: Record<string, string[] | string>): string {
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries(f)) {
    const s = Array.isArray(v) ? v.join(',') : v
    if (s) p.set(k, s)
  }
  const q = p.toString()
  return q ? `?${q}` : ''
}

export interface Col { key: string; label: string; fmt?: Fmt | 'text' }

/** Celda segura para CSV: evita que Excel ejecute fórmulas (=, +, -, @ al inicio) y escapa comillas. */
export function celdaCsv(v: unknown): string {
  if (typeof v === 'number') return String(v).replace('.', ',')
  let s = String(v ?? '')
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`
  return `"${s.replace(/"/g, '""')}"`
}

function exportar(cols: Col[], rows: object[], nombre: string) {
  const head = cols.map((c) => celdaCsv(c.label)).join(';')
  const body = rows.map((r) => cols.map((c) => celdaCsv((r as Record<string, unknown>)[c.key])).join(";"))
  const blob = new Blob(['﻿' + [head, ...body].join('\n')], { type: 'text/csv;charset=utf-8' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `${nombre.replace(/[^\wáéíóúñ ]/gi, '').trim() || 'datos'}.csv`
  a.click()
  URL.revokeObjectURL(a.href)
}

const celda = (v: unknown, fmt?: Fmt | 'text') => (fmt && fmt !== 'text' ? fmtV(v, fmt, false) : v == null || v === '' ? '—' : String(v))

/** Tarjeta estándar de gráfica (como fortuner-dashboards): título, ayuda, vista de tabla accesible y CSV. */
export function ChartCard({ title, subtitle, info, actions, table, children, className, height = 280, cargando }: {
  title: string; subtitle?: ReactNode; info?: string; actions?: ReactNode; className?: string; height?: number; cargando?: boolean
  table?: { cols: Col[]; rows: object[] }; children: ReactNode
}) {
  const [tabla, setTabla] = useState(false)
  return (
    <section className={clsx('card flex min-w-0 flex-col', className)}>
      <header className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1.5 px-4 pt-3.5 pb-2">
        <div className="min-w-[180px] flex-1">
          <h3 className="flex items-center gap-1.5 text-[14.5px] font-semibold text-ink">
            {title}
            {info && (
              <button type="button" className="group relative" aria-label={`Ayuda: ${info}`}>
                <Info size={13} className="text-ink-3" />
                <span role="tooltip" className="pointer-events-none absolute top-5 left-0 z-30 hidden w-72 rounded-xl border border-line bg-surface p-3 text-left text-[12px] font-normal leading-relaxed text-ink-2 shadow-[0_20px_40px_-16px_rgba(0,45,73,.45)] group-hover:block group-focus:block">{info}</span>
              </button>
            )}
          </h3>
          {subtitle && <p className="mt-0.5 text-[12px] text-ink-3">{subtitle}</p>}
        </div>
        <div className="flex flex-wrap items-center justify-end gap-1">
          {actions}
          {table && table.rows.length > 0 && (
            <>
              <button type="button" title={tabla ? 'Ver gráfica' : 'Ver tabla'} aria-label={tabla ? 'Ver gráfica' : 'Ver tabla'} aria-pressed={tabla} onClick={() => setTabla(!tabla)}
                className="grid h-7 w-7 place-items-center rounded-[10px] text-ink-3 transition hover:bg-surface-hover hover:text-ink">{tabla ? <BarChart3 size={15} /> : <Table2 size={15} />}</button>
              <button type="button" title="Exportar CSV" aria-label={`Exportar ${title} a CSV`} onClick={() => exportar(table.cols, table.rows, title)}
                className="grid h-7 w-7 place-items-center rounded-[10px] text-ink-3 transition hover:bg-surface-hover hover:text-ink"><Download size={15} /></button>
            </>
          )}
        </div>
      </header>
      <div className="relative min-h-0 flex-1 px-3 pb-3">
        {cargando ? <Skeleton h={height} /> : tabla && table ? (
          <div className="overflow-auto scroll-thin" style={{ maxHeight: height + 40 }}>
            <table className="w-full text-[12.5px]">
              <thead><tr>{table.cols.map((c) => <th key={c.key} scope="col" className={clsx('px-2 py-1.5 font-semibold', c.fmt && c.fmt !== 'text' ? 'text-right' : 'text-left')}>{c.label}</th>)}</tr></thead>
              <tbody>{table.rows.map((r, i) => (
                <tr key={i} className="border-t border-line">{table.cols.map((c) => <td key={c.key} className={clsx("px-2 py-1.5 text-ink", c.fmt && c.fmt !== "text" && "text-right tnum")}>{celda((r as Record<string, unknown>)[c.key], c.fmt)}</td>)}</tr>
              ))}</tbody>
            </table>
          </div>
        ) : children}
      </div>
    </section>
  )
}

/** Tarjeta de indicador: valor grande, detalle y una barra de proporción opcional. */
export function Kpi({ label, value, sub, pct, tone = 'brand', info }: { label: string; value: string; sub?: ReactNode; pct?: number | null; tone?: 'brand' | 'good' | 'warn' | 'bad' | 'mint'; info?: string }) {
  const color = { brand: 'var(--brand)', good: 'var(--good)', warn: 'var(--warn)', bad: 'var(--bad)', mint: 'var(--fx-mint)' }[tone]
  return (
    <div className="card flex min-w-0 flex-col px-4 py-3" title={info}>
      <span className="line-clamp-2 text-[12px] leading-tight font-medium text-ink-3">{label}</span>
      <span className="mt-1 truncate text-[22px] leading-tight font-bold tracking-tight text-ink tnum">{value}</span>
      {sub && <span className="mt-0.5 truncate text-[11.5px] text-ink-3">{sub}</span>}
      {pct != null && (
        <span className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-2" role="img" aria-label={`${Math.round(pct)}%`}>
          <span className="block h-full rounded-full" style={{ width: `${Math.max(0, Math.min(100, pct))}%`, background: color }} />
        </span>
      )}
    </div>
  )
}

export function Seccion({ titulo, desc, children }: { titulo: string; desc?: string; children: ReactNode }) {
  return (
    <section className="space-y-3" aria-label={titulo}>
      <div className="flex items-end justify-between gap-3 border-b border-line pb-1.5">
        <div><h2 className="text-[16px] font-semibold text-ink">{titulo}</h2>{desc && <p className="text-[12px] text-ink-3">{desc}</p>}</div>
      </div>
      {children}
    </section>
  )
}

/** Grupo de chips de selección múltiple para la barra de filtros. */
export function Filtro({ label, opciones, valor, onChange }: { label: string; opciones: { id: string; label: string; color?: string }[]; valor: string[]; onChange: (v: string[]) => void }) {
  return (
    <fieldset className="min-w-0">
      <legend className="mb-1 text-[11.5px] font-semibold tracking-wide text-ink-3 uppercase">{label}</legend>
      <div className="flex flex-wrap gap-1.5">
        {opciones.map((o) => {
          const on = valor.includes(o.id)
          return (
            <button key={o.id} type="button" aria-pressed={on} onClick={() => onChange(on ? valor.filter((x) => x !== o.id) : [...valor, o.id])}
              className={clsx('inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] font-medium transition',
                on ? 'border-brand bg-brand-soft text-brand' : 'border-line-strong text-ink-2 hover:bg-surface-hover')}>
              {o.color && <span aria-hidden="true" className="h-2 w-2 rounded-full" style={{ background: o.color }} />}{o.label}
            </button>
          )
        })}
      </div>
    </fieldset>
  )
}

// Los filtros desplegables viven en components/filtros.tsx (los comparte la lista de Clientes 360°).
export { FiltroActivo, FiltroMenu, type OpcionFiltro } from '@/components/filtros'

export function Estado({ error, cargando, children }: { error: unknown; cargando: boolean; children: ReactNode }) {
  if (error && !cargando) return <ErrorBox error={error} />
  return <>{children}</>
}
