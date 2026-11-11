import clsx from 'clsx'
import { AlertTriangle, Check, ChevronDown, Inbox, Loader2, RotateCw, Search, X } from 'lucide-react'
import { useEffect, useId, useMemo, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react'

export const errorMessage = (e: unknown) => (e instanceof Error && e.message ? e.message : 'No fue posible cargar la información')

export function Skeleton({ h = 120, className }: { h?: number; className?: string }) {
  return <div className={clsx('skeleton w-full', className)} style={{ height: h }} />
}

export function Spinner({ size = 16 }: { size?: number }) {
  return <Loader2 size={size} className="animate-spin" aria-hidden="true" />
}

export function ErrorBox({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex items-center gap-2 rounded-lg border border-bad/30 bg-bad-soft px-3 py-2 text-[13px] text-bad">
      <AlertTriangle size={16} className="shrink-0" />
      <span className="min-w-0 flex-1">{errorMessage(error)}</span>
      {onRetry && (
        <button type="button" onClick={onRetry} className="flex shrink-0 items-center gap-1 rounded-md border border-current/30 px-2 py-0.5 font-semibold hover:bg-white/30">
          <RotateCw size={12} /> Reintentar
        </button>
      )}
    </div>
  )
}

export function Empty({ text, hint, action }: { text: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="flex min-h-32 flex-col items-center justify-center gap-1 py-6 text-center text-[13px] text-ink-3">
      <Inbox size={22} aria-hidden="true" />
      <div className="font-medium text-ink-2">{text}</div>
      {hint && <div className="max-w-md text-[12px]">{hint}</div>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'accent'
interface BtnProps extends ButtonHTMLAttributes<HTMLButtonElement> { variant?: Variant; busy?: boolean; icon?: ReactNode; small?: boolean }

export function Btn({ variant = 'secondary', busy, icon, small, children, className, disabled, ...rest }: BtnProps) {
  const styles: Record<Variant, string> = {
    primary: 'bg-brand text-white hover:opacity-90 border-transparent',
    accent: 'bg-accent text-white hover:bg-accent-hover border-transparent',
    secondary: 'bg-surface text-ink-2 border-line-strong hover:bg-surface-hover',
    ghost: 'bg-transparent text-ink-2 border-transparent hover:bg-surface-hover',
    danger: 'bg-bad text-white border-transparent hover:opacity-90',
  }
  return (
    <button type="button" disabled={disabled || busy} {...rest}
      className={clsx('inline-flex items-center justify-center gap-1.5 rounded-lg border font-semibold whitespace-nowrap transition disabled:cursor-not-allowed disabled:opacity-50',
        small ? 'h-8 px-2.5 text-[12.5px]' : 'h-9 px-3.5 text-[13px]', styles[variant], className)}>
      {busy ? <Spinner size={14} /> : icon}
      {children}
    </button>
  )
}

export function IconBtn({ title, children, onClick, className, danger }: { title: string; children: ReactNode; onClick?: () => void; className?: string; danger?: boolean }) {
  return (
    <button type="button" title={title} aria-label={title} onClick={onClick}
      className={clsx('grid h-8 w-8 place-items-center rounded-lg border border-transparent text-ink-2 transition hover:bg-surface-hover', danger && 'hover:text-bad', className)}>
      {children}
    </button>
  )
}

type Tone = 'neutral' | 'brand' | 'good' | 'warn' | 'bad'
export function Badge({ tone = 'neutral', children, title }: { tone?: Tone; children: ReactNode; title?: string }) {
  const t: Record<Tone, string> = {
    neutral: 'bg-surface-2 text-ink-2 border-line', brand: 'bg-brand-soft text-brand border-brand/20',
    good: 'bg-good-soft text-good border-good/20', warn: 'bg-warn-soft text-warn border-warn/25', bad: 'bg-bad-soft text-bad border-bad/20',
  }
  return <span title={title} className={clsx('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold', t[tone])}>{children}</span>
}

export function Card({ title, subtitle, actions, children, className, pad = true }: { title?: ReactNode; subtitle?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; pad?: boolean }) {
  return (
    <section className={clsx('card', className)}>
      {(title || actions) && (
        <header className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
          <div className="min-w-0 flex-1">
            <h2 className="text-[14px] font-bold text-ink">{title}</h2>
            {subtitle && <div className="text-[12px] text-ink-3">{subtitle}</div>}
          </div>
          {actions}
        </header>
      )}
      <div className={clsx(pad && 'p-4')}>{children}</div>
    </section>
  )
}

export function Notice({ tone = 'warn', children, icon }: { tone?: 'warn' | 'info' | 'bad' | 'good'; children: ReactNode; icon?: ReactNode }) {
  const t = { warn: 'border-warn/30 bg-warn-soft text-warn', info: 'border-info/30 bg-info-soft text-info', bad: 'border-bad/30 bg-bad-soft text-bad', good: 'border-good/30 bg-good-soft text-good' }[tone]
  return <div role={tone === 'bad' ? 'alert' : 'note'} className={clsx('flex items-start gap-2 rounded-lg border px-3 py-2 text-[12.5px] leading-snug', t)}>{icon ?? <AlertTriangle size={15} className="mt-0.5 shrink-0" />}<div className="min-w-0 flex-1">{children}</div></div>
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[12px] font-semibold text-ink-2">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11.5px] text-ink-3">{hint}</span>}
    </label>
  )
}

export const inputCls = 'h-9 w-full rounded-lg border border-line-strong bg-surface px-3 text-[13px] text-ink outline-none placeholder:text-ink-3 focus:border-brand'

export function SearchInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div className="relative">
      <Search size={14} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-3" />
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={placeholder}
        className={clsx(inputCls, 'pl-8')} />
    </div>
  )
}

/** Casilla de verificación con estilo de «chip»: se usa en las listas de segmentación (check list). */
export function Chip({ checked, onChange, children, disabled, title }: { checked: boolean; onChange: (v: boolean) => void; children: ReactNode; disabled?: boolean; title?: string }) {
  return (
    <label title={title} className={clsx('inline-flex cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[12.5px] font-medium transition select-none',
      checked ? 'border-brand bg-brand-soft text-brand' : 'border-line-strong bg-surface text-ink-2 hover:bg-surface-hover', disabled && 'cursor-not-allowed opacity-50')}>
      <input type="checkbox" className="sr-only" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className={clsx('grid h-3.5 w-3.5 place-items-center rounded-[4px] border', checked ? 'border-brand bg-brand text-white' : 'border-line-strong')}>{checked && <Check size={10} strokeWidth={3.5} />}</span>
      {children}
    </label>
  )
}

export function ChipGroup<T extends string | number>({ options, value, onChange }: { options: { id: T; label: ReactNode; title?: string }[]; value: T[]; onChange: (v: T[]) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => (
        <Chip key={String(o.id)} title={o.title} checked={value.includes(o.id)}
          onChange={(c) => onChange(c ? [...value, o.id] : value.filter((x) => x !== o.id))}>{o.label}</Chip>
      ))}
    </div>
  )
}

/** Lista desplegable con búsqueda y selección múltiple (para familia, grupo, marca… que tienen cientos de valores). */
export function MultiSelect({ label, options, value, onChange, placeholder = 'Todos' }: {
  label: string; options: { codigo: string; nombre: string; productos?: number }[]; value: string[]; onChange: (v: string[]) => void; placeholder?: string
}) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const ref = useRef<HTMLDivElement>(null)
  const id = useId()
  useEffect(() => {
    if (!open) return
    const h = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [open])
  const shown = useMemo(() => {
    const n = q.trim().toLowerCase()
    return (n ? options.filter((o) => o.nombre.toLowerCase().includes(n)) : options).slice(0, 200)
  }, [options, q])
  const nombres = useMemo(() => new Map(options.map((o) => [o.codigo, o.nombre])), [options])
  return (
    <div ref={ref} className="relative">
      <span className="mb-1 block text-[12px] font-semibold text-ink-2">{label}</span>
      <button type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}
        className={clsx(inputCls, 'flex items-center justify-between gap-2 text-left')}>
        <span className="truncate">{value.length === 0 ? <span className="text-ink-3">{placeholder}</span> : value.length === 1 ? nombres.get(value[0]) ?? value[0] : `${value.length} seleccionados`}</span>
        <span className="flex items-center gap-1">
          {value.length > 0 && <span role="button" tabIndex={0} aria-label={`Quitar ${label}`} onClick={(e) => { e.stopPropagation(); onChange([]) }}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); onChange([]) } }} className="rounded p-0.5 hover:bg-surface-hover"><X size={13} /></span>}
          <ChevronDown size={14} className="text-ink-3" />
        </span>
      </button>
      {open && (
        <div id={id} className="absolute z-30 mt-1 w-full min-w-56 rounded-lg border border-line-strong bg-surface shadow-lg">
          <div className="border-b border-line p-2"><SearchInput value={q} onChange={setQ} placeholder={`Buscar ${label.toLowerCase()}…`} /></div>
          <ul className="max-h-60 overflow-y-auto p-1 scroll-thin">
            {shown.length === 0 && <li className="px-3 py-2 text-[12px] text-ink-3">Sin resultados</li>}
            {shown.map((o) => {
              const on = value.includes(o.codigo)
              return (
                <li key={o.codigo}>
                  <button type="button" onClick={() => onChange(on ? value.filter((x) => x !== o.codigo) : [...value, o.codigo])}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12.5px] hover:bg-surface-hover">
                    <span className={clsx('grid h-3.5 w-3.5 shrink-0 place-items-center rounded-[4px] border', on ? 'border-brand bg-brand text-white' : 'border-line-strong')}>{on && <Check size={10} strokeWidth={3.5} />}</span>
                    <span className="min-w-0 flex-1 truncate">{o.nombre}</span>
                    {o.productos != null && <span className="text-[11px] text-ink-3 tnum">{o.productos}</span>}
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </div>
  )
}

export function ConfirmDialog({ open, title, children, confirmLabel, danger, busy, onConfirm, onCancel }: {
  open: boolean; title: string; children: ReactNode; confirmLabel: string; danger?: boolean; busy?: boolean; onConfirm: () => void; onCancel: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    ref.current?.focus()
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel() }
    document.addEventListener('keydown', h)
    return () => document.removeEventListener('keydown', h)
  }, [open, onCancel])
  if (!open) return null
  return (
    <div className="fixed inset-0 z-[100] grid place-items-center bg-black/50 p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel() }}>
      <div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-label={title} className="card w-full max-w-md p-5 outline-none">
        <h3 className="text-[16px] font-bold text-ink">{title}</h3>
        <div className="mt-2 text-[13px] leading-relaxed text-ink-2">{children}</div>
        <div className="mt-5 flex justify-end gap-2">
          <Btn onClick={onCancel} disabled={busy}>Cancelar</Btn>
          <Btn variant={danger ? 'danger' : 'primary'} busy={busy} onClick={onConfirm}>{confirmLabel}</Btn>
        </div>
      </div>
    </div>
  )
}

export function Stat({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: 'good' | 'warn' | 'bad' }) {
  return (
    <div className="rounded-xl border border-line bg-surface-2 px-3.5 py-3">
      <div className="text-[11.5px] font-semibold text-ink-3">{label}</div>
      <div className={clsx('mt-0.5 text-[20px] leading-tight font-bold tnum', tone === 'good' ? 'text-good' : tone === 'warn' ? 'text-warn' : tone === 'bad' ? 'text-bad' : 'text-ink')}>{value}</div>
      {sub && <div className="mt-0.5 text-[11.5px] text-ink-3">{sub}</div>}
    </div>
  )
}

/** Barra horizontal simple para composiciones (segmentos, edades…): accesible, sin librerías de gráficas. */
export function Bars({ rows, total }: { rows: { label: string; n: number }[]; total?: number }) {
  const t = total ?? rows.reduce((a, r) => a + r.n, 0)
  const max = Math.max(1, ...rows.map((r) => r.n))
  return (
    <ul className="space-y-1.5">
      {rows.map((r) => (
        <li key={r.label} className="grid grid-cols-[minmax(0,7rem)_1fr_auto] items-center gap-2 text-[12px]">
          <span className="truncate text-ink-2" title={r.label}>{r.label}</span>
          <span className="h-2 overflow-hidden rounded-full bg-surface-2"><span className="block h-full rounded-full bg-brand" style={{ width: `${(100 * r.n) / max}%` }} /></span>
          <span className="tnum text-ink-3">{r.n.toLocaleString('es-CO')}{t ? ` · ${Math.round((100 * r.n) / t)}%` : ''}</span>
        </li>
      ))}
    </ul>
  )
}
