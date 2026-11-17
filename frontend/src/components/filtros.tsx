import clsx from 'clsx'
import { Check, ChevronDown, X } from 'lucide-react'
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'

// Barra de filtros con botones desplegables (Analítica de clientes y lista de Clientes 360°): ocupa una sola fila y
// cada botón dice qué tiene elegido; los filtros activos se pueden quitar uno a uno con las pastillas de abajo.

export interface OpcionFiltro { id: string; label: string; color?: string }

/** Botón con panel desplegable (se cierra con clic fuera o Escape). Base de FiltroMenu y de los filtros a medida. */
export function Desplegable({ label, resumen, n = 0, activo, children, ancho = 260 }: {
  label: string; resumen?: string | null; n?: number; activo: boolean; children: (cerrar: () => void) => ReactNode; ancho?: number
}) {
  const [abierto, setAbierto] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const id = useId()
  useEffect(() => {
    if (!abierto) return
    const fuera = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setAbierto(false) }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setAbierto(false) }
    document.addEventListener('mousedown', fuera)
    document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('mousedown', fuera); document.removeEventListener('keydown', esc) }
  }, [abierto])
  return (
    <div ref={ref} className="relative">
      <button type="button" aria-expanded={abierto} aria-controls={id} aria-haspopup="true" onClick={() => setAbierto(!abierto)}
        className={clsx('inline-flex h-9 max-w-[260px] items-center gap-1.5 rounded-full border px-3.5 text-[12.5px] font-medium transition',
          activo ? 'border-brand bg-brand-soft text-brand' : 'border-line-strong bg-surface text-ink-2 hover:bg-surface-hover hover:text-ink')}>
        <span className="truncate">{label}{resumen ? <>: <b className="font-semibold">{resumen}</b></> : null}</span>
        {n > 1 && <span className="grid h-[18px] min-w-[18px] place-items-center rounded-full bg-brand px-1 text-[10.5px] font-bold text-white">{n}</span>}
        <ChevronDown size={14} className={clsx('shrink-0 transition', abierto && 'rotate-180')} />
      </button>
      {abierto && (
        <div id={id} role="group" aria-label={label} style={{ width: ancho }}
          className="absolute top-11 left-0 z-40 max-w-[calc(100vw-32px)] rounded-2xl border border-line bg-surface p-2 shadow-[0_24px_48px_-20px_rgba(0,45,73,.45)]">
          {children(() => setAbierto(false))}
        </div>
      )}
    </div>
  )
}

/** Filtro de opciones. Selección múltiple (casillas) o única (`unico`: elegir otra reemplaza; se cierra al elegir). */
export function FiltroMenu({ label, opciones, valor, onChange, unico, neutro }: {
  label: string; opciones: OpcionFiltro[]; valor: string[]; onChange: (v: string[]) => void; unico?: boolean
  neutro?: boolean   // el valor elegido es el normal (p. ej. «solo activos»): el botón no se resalta
}) {
  const [q, setQ] = useState('')
  const busca = opciones.length > 10
  const vistas = useMemo(() => {
    const n = q.trim().toLowerCase()
    return n ? opciones.filter((o) => o.label.toLowerCase().includes(n)) : opciones
  }, [opciones, q])
  const resumen = valor.length === 1 && !neutro ? opciones.find((o) => o.id === valor[0])?.label ?? null : null
  return (
    <Desplegable label={label} resumen={resumen} n={neutro ? 0 : valor.length} activo={valor.length > 0 && !neutro}>
      {(cerrar) => (
        <>
          {busca && (
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Buscar ${label.toLowerCase()}…`} aria-label={`Buscar ${label.toLowerCase()}`}
              className="mb-1.5 h-9 w-full rounded-xl border border-line-strong bg-surface-2 px-3 text-[12.5px] text-ink outline-none focus:border-brand" />
          )}
          <div className="max-h-72 overflow-y-auto scroll-thin">
            {vistas.map((o) => {
              const on = valor.includes(o.id)
              return unico ? (
                <button key={o.id} type="button" role="menuitemradio" aria-checked={on} onClick={() => { onChange(on ? [] : [o.id]); cerrar() }}
                  className={clsx('flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] hover:bg-surface-hover', on ? 'font-semibold text-brand' : 'text-ink')}>
                  <span className="grid h-4 w-4 shrink-0 place-items-center">{on && <Check size={15} />}</span>
                  {o.color && <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: o.color }} />}
                  <span className="truncate">{o.label}</span>
                </button>
              ) : (
                <label key={o.id} className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] text-ink hover:bg-surface-hover">
                  <input type="checkbox" checked={on} onChange={() => onChange(on ? valor.filter((x) => x !== o.id) : [...valor, o.id])} className="h-4 w-4 accent-[var(--brand)]" />
                  {o.color && <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: o.color }} />}
                  <span className="truncate">{o.label}</span>
                </label>
              )
            })}
            {!vistas.length && <div className="px-2.5 py-3 text-[12.5px] text-ink-3">Sin coincidencias</div>}
          </div>
          {valor.length > 0 && (
            <button type="button" onClick={() => onChange([])} className="mt-1 w-full rounded-lg px-2.5 py-1.5 text-left text-[12px] font-semibold text-brand hover:bg-brand-soft">Quitar selección</button>
          )}
        </>
      )}
    </Desplegable>
  )
}

/** Pastilla de un filtro activo, con botón para quitarlo. */
export function FiltroActivo({ texto, color, onQuitar }: { texto: string; color?: string; onQuitar: () => void }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-2 py-1 pr-1 pl-2.5 text-[12px] font-medium text-ink-2">
      {color && <span aria-hidden="true" className="h-2 w-2 rounded-full" style={{ background: color }} />}
      {texto}
      <button type="button" aria-label={`Quitar filtro ${texto}`} onClick={onQuitar} className="grid h-5 w-5 place-items-center rounded-full text-ink-3 hover:bg-surface-hover hover:text-ink"><X size={12} /></button>
    </span>
  )
}
