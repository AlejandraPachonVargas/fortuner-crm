import clsx from 'clsx'
import { X } from 'lucide-react'
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { useSesion } from './datos'
import type { Permisos, Rol } from './modelo'

// ------------------------------------------------------------------------------------------ rol y permisos
// Los permisos REALES los decide el servidor según la clave de acceso (mercadeo o administración) y CRM_CLIENTES_ESCRITURA.
// «Probar como: Solo lectura» solo sirve para ver la pantalla como la vería un consultor: puede quitar permisos, nunca darlos.
const RolCtx = createContext<{ vistaLectura: boolean; setVistaLectura: (v: boolean) => void }>({ vistaLectura: false, setVistaLectura: () => undefined })
export function RolProvider({ children }: { children: ReactNode }) {
  const [vistaLectura, setV] = useState<boolean>(() => { try { return localStorage.getItem('crm-rol-demo') === 'lectura' } catch { return false } })
  const setVistaLectura = (v: boolean) => { setV(v); try { localStorage.setItem('crm-rol-demo', v ? 'lectura' : 'servidor') } catch { /* sin storage */ } }
  return <RolCtx.Provider value={{ vistaLectura, setVistaLectura }}>{children}</RolCtx.Provider>
}
const NINGUNO: Permisos = { editar: false, eliminar: false, importar: false, verContacto: false, fusionar: false }
export function useRol(): { rol: Rol; rolServidor: Rol | null; vistaLectura: boolean; setVistaLectura: (v: boolean) => void } {
  const { vistaLectura, setVistaLectura } = useContext(RolCtx)
  const s = useSesion().data
  return { rol: vistaLectura ? 'lectura' : (s?.rol ?? 'lectura'), rolServidor: s?.rol ?? null, vistaLectura, setVistaLectura }
}
export function usePermisos(): Permisos {
  const { vistaLectura } = useContext(RolCtx)
  const s = useSesion().data
  if (!s || vistaLectura) return NINGUNO
  return s.permisos
}

/** Enmascara datos de contacto para el rol de solo lectura. */
export const mascara = (v: string, ver: boolean) => (ver || !v ? v : v.includes('@') ? v.replace(/^(.).*(@.*)$/, '$1***$2') : v.replace(/.(?=.{4})/g, '•'))

// ------------------------------------------------------------------------------------------ piezas visuales
const PALETA = ['#1c5cab', '#0e8f6e', '#b45a0b', '#7c3aed', '#be185d', '#0369a1', '#4d7c0f', '#9a3412']
export function Avatar({ nombre, size = 36, anonimo }: { nombre: string; size?: number; anonimo?: boolean }) {
  const ini = anonimo ? '?' : nombre.split(' ').filter(Boolean).slice(0, 2).map((p) => p[0]).join('').toUpperCase()
  const color = PALETA[[...nombre].reduce((a, c) => a + c.charCodeAt(0), 0) % PALETA.length]
  return <span aria-hidden="true" className="grid shrink-0 place-items-center rounded-full font-bold text-white" style={{ width: size, height: size, background: anonimo ? '#94a3b8' : color, fontSize: size * 0.38 }}>{ini}</span>
}

/** Anillo de progreso (completitud de la ficha). */
export function Anillo({ valor, size = 44, grosor = 5 }: { valor: number; size?: number; grosor?: number }) {
  const r = (size - grosor) / 2, c = 2 * Math.PI * r
  const color = valor >= 80 ? 'var(--good)' : valor >= 50 ? 'var(--warn)' : 'var(--bad)'
  return (
    <span className="relative inline-grid shrink-0 place-items-center" style={{ width: size, height: size }} role="img" aria-label={`Ficha completa al ${valor}%`}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--line)" strokeWidth={grosor} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={grosor} strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - valor / 100)} />
      </svg>
      <span className="absolute text-[11px] font-bold tnum text-ink">{valor}</span>
    </span>
  )
}

export function Pestanas<T extends string>({ valor, onChange, items }: { valor: T; onChange: (v: T) => void; items: { id: T; label: string; icon?: ReactNode; n?: number }[] }) {
  return (
    <div role="tablist" aria-label="Secciones de la ficha" className="flex gap-1 overflow-x-auto border-b border-line scroll-thin">
      {items.map((t) => (
        <button key={t.id} type="button" role="tab" aria-selected={valor === t.id} onClick={() => onChange(t.id)}
          className={clsx('-mb-px flex shrink-0 items-center gap-2 border-b-2 px-3.5 py-2.5 text-[13px] font-semibold transition', valor === t.id ? 'border-brand text-brand' : 'border-transparent text-ink-3 hover:text-ink')}>
          {t.icon}{t.label}{t.n != null && <span className={clsx('rounded-full px-1.5 text-[11px] tnum', valor === t.id ? 'bg-brand-soft text-brand' : 'bg-surface-2 text-ink-3')}>{t.n}</span>}
        </button>
      ))}
    </div>
  )
}

/** Ventana modal accesible (Esc o clic fuera para cerrar). */
export function Modal({ abierto, titulo, subtitulo, onCerrar, children, pie, ancho = 'max-w-lg' }: { abierto: boolean; titulo: string; subtitulo?: string; onCerrar: () => void; children: ReactNode; pie?: ReactNode; ancho?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!abierto) return
    ref.current?.focus()
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onCerrar() }
    document.addEventListener('keydown', h)
    return () => document.removeEventListener('keydown', h)
  }, [abierto, onCerrar])
  if (!abierto) return null
  return (
    <div className="fixed inset-0 z-[100] grid place-items-center overflow-y-auto bg-black/50 p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) onCerrar() }}>
      <div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-label={titulo} className={clsx('card my-auto flex max-h-[92vh] w-full flex-col outline-none', ancho)}>
        <header className="flex items-start gap-3 border-b border-line px-5 py-4">
          <div className="min-w-0 flex-1"><h3 className="text-[16px] font-bold text-ink">{titulo}</h3>{subtitulo && <p className="mt-0.5 text-[12.5px] text-ink-3">{subtitulo}</p>}</div>
          <button type="button" aria-label="Cerrar" onClick={onCerrar} className="grid h-8 w-8 place-items-center rounded-lg text-ink-3 hover:bg-surface-hover"><X size={17} /></button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 scroll-thin">{children}</div>
        {pie && <footer className="flex flex-wrap justify-end gap-2 border-t border-line px-5 py-3">{pie}</footer>}
      </div>
    </div>
  )
}

export const selectCls = 'h-9 w-full rounded-lg border border-line-strong bg-surface px-2.5 text-[13px] text-ink outline-none focus:border-brand disabled:opacity-60'

export function Campo({ etiqueta, error, ayuda, children, requerido }: { etiqueta: string; error?: string | null; ayuda?: ReactNode; children: ReactNode; requerido?: boolean }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[12px] font-semibold text-ink-2">{etiqueta}{requerido && <span className="text-bad"> *</span>}</span>
      {children}
      {error ? <span role="alert" className="mt-1 block text-[11.5px] text-bad">{error}</span> : ayuda ? <span className="mt-1 block text-[11.5px] text-ink-3">{ayuda}</span> : null}
    </label>
  )
}
