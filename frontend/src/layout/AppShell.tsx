import clsx from 'clsx'
import {
  BarChart3, ChevronDown, Gift, History, Megaphone, Moon, MoreHorizontal, PlusCircle, Settings, ShieldCheck, Sun, UserPlus,
  Users, Workflow, type LucideIcon,
} from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { useGet, type Estado } from '@/lib/api'
import { fmtFecha } from '@/lib/format'

// Cabecera Fortuner 27 (GUIA_REDISENO_MODULOS.md §7.1 y §7.2): logo y navegación arriba, sin barra lateral.
const LOGO = '/fortuner-logo-oscuro.png'
const ISOTIPO = '/fortuner-isotipo.png'

interface Opcion { id: string; label: string; to: string; icon: LucideIcon; end?: boolean; proximamente?: boolean }
interface Grupo { id: string; label: string; icon: LucideIcon; prefijo?: string; opciones: Opcion[] }

// Mismas pantallas que antes, ahora organizadas en grupos con menú desplegable.
const GRUPOS: Grupo[] = [
  { id: 'campanas', label: 'Campañas', icon: Megaphone, prefijo: '/campanas', opciones: [
    { id: 'historial', label: 'Historial de campañas', to: '/campanas', icon: History, end: true },
    { id: 'nueva', label: 'Nueva campaña', to: '/campanas/nueva', icon: PlusCircle, end: true },
  ] },
  { id: 'clientes', label: 'Clientes 360°', icon: Users, prefijo: '/clientes', opciones: [
    { id: 'lista', label: 'Clientes', to: '/clientes', icon: Users, end: true },
    { id: 'nuevo', label: 'Nuevo cliente', to: '/clientes/nuevo', icon: UserPlus, end: true },
    { id: 'calidad', label: 'Calidad de datos', to: '/clientes/calidad', icon: ShieldCheck, end: true },
    { id: 'afiliaciones', label: 'Afiliaciones', to: '/clientes/afiliaciones', icon: Gift, end: true },
  ] },
]
const MAS: Grupo = { id: 'mas', label: 'Más', icon: MoreHorizontal, opciones: [
  { id: 'auto', label: 'Automatizaciones', to: '', icon: Workflow, proximamente: true },
  { id: 'analitica', label: 'Analítica de campañas', to: '', icon: BarChart3, proximamente: true },
  { id: 'config', label: 'Configuración', to: '', icon: Settings, proximamente: true },
] }

function useTheme() {
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    try { return (localStorage.getItem('crm-theme') as 'light' | 'dark') ?? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') } catch { return 'light' }
  })
  useEffect(() => {
    document.documentElement.dataset.theme = theme
    try { localStorage.setItem('crm-theme', theme) } catch { /* sin storage */ }
  }, [theme])
  return [theme, () => setTheme(theme === 'dark' ? 'light' : 'dark')] as const
}

const coincide = (o: Opcion, path: string) => (o.end ? path === o.to : path.startsWith(o.to))
/** La opción del grupo que corresponde a la pantalla actual (la ficha de un cliente cuenta como «Clientes»). */
function opcionActual(g: Grupo, path: string): Opcion | undefined {
  return g.opciones.find((o) => o.to && coincide(o, path)) ?? (g.prefijo && path.startsWith(g.prefijo) ? g.opciones[0] : undefined)
}

function Chip({ children, punto = 'mint', title }: { children: ReactNode; punto?: 'mint' | 'warn' | 'bad'; title?: string }) {
  const color = { mint: 'bg-[#21CC93] shadow-[0_0_0_3px_rgba(33,204,147,.25)]', warn: 'bg-[#F5B301] shadow-[0_0_0_3px_rgba(245,179,1,.25)]', bad: 'bg-[#F27A6E] shadow-[0_0_0_3px_rgba(242,122,110,.25)]' }[punto]
  return (
    <span title={title} className="inline-flex min-w-0 items-center gap-2 rounded-full border border-white/12 bg-white/8 px-3 py-1.5 text-[12.5px] font-medium whitespace-nowrap">
      <span className={clsx('h-[7px] w-[7px] shrink-0 rounded-full', color)} />
      <span className="hidden truncate sm:inline">{children}</span>
    </span>
  )
}

export default function AppShell({ children }: { children: ReactNode }) {
  const [theme, toggle] = useTheme()
  const loc = useLocation()
  const { data: sys } = useGet<Estado>('/sistema/estado', { stale: 30_000 })
  const dias = sys?.warehouse ? Math.floor((Date.now() - new Date(sys.warehouse.fecha_max + 'T00:00:00').getTime()) / 864e5) : null
  const [abierto, setAbierto] = useState<{ id: string; left: number } | null>(null)
  const headerRef = useRef<HTMLElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => { setAbierto(null) }, [loc.pathname])
  useEffect(() => {
    if (!abierto) return
    const cerrar = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !headerRef.current?.querySelector('nav')?.contains(e.target as Node) && !panelRef.current?.contains(e.target as Node)) setAbierto(null)
    }
    document.addEventListener('mousedown', cerrar)
    document.addEventListener('keydown', cerrar)
    return () => { document.removeEventListener('mousedown', cerrar); document.removeEventListener('keydown', cerrar) }
  }, [abierto])
  // El panel se ubica bajo su pestaña, sin salirse de la pantalla.
  useLayoutEffect(() => {
    if (!abierto || !panelRef.current || !headerRef.current) return
    const max = headerRef.current.clientWidth - panelRef.current.offsetWidth - 16
    const ajustado = Math.max(16, max)
    // Solo si cambia: en celular el panel ocupa todo el ancho y «max» es negativo (sin esto se repetía sin fin).
    if (abierto.left > max && abierto.left !== ajustado) setAbierto({ ...abierto, left: ajustado })
  }, [abierto])

  const abrir = (id: string, boton: HTMLElement) => {
    if (abierto?.id === id) { setAbierto(null); return }
    const h = headerRef.current!.getBoundingClientRect(), b = boton.getBoundingClientRect()
    setAbierto({ id, left: b.left - h.left })
  }
  const grupoAbierto = [...GRUPOS, MAS].find((g) => g.id === abierto?.id)
  const seccion = GRUPOS.find((g) => g.prefijo && loc.pathname.startsWith(g.prefijo))

  const Pestana = ({ g }: { g: Grupo }) => {
    const activo = !!opcionActual(g, loc.pathname) && g.id !== 'mas'
    const Icon = g.icon
    return (
      <button type="button" aria-haspopup="menu" aria-expanded={abierto?.id === g.id} onClick={(e) => abrir(g.id, e.currentTarget)}
        className={clsx('relative flex shrink-0 items-center gap-2 px-3 py-3 text-[13px] whitespace-nowrap transition-colors sm:px-4 sm:py-3.5 sm:text-[13.5px]',
          activo ? 'font-semibold text-white' : 'font-medium text-white/70 hover:bg-white/5 hover:text-white')}>
        <Icon size={17} strokeWidth={activo ? 2.3 : 1.9} className={activo ? 'text-[#21CC93]' : ''} />
        {g.label}
        <ChevronDown size={15} className={clsx('transition-transform', abierto?.id === g.id && 'rotate-180')} />
        {activo && <span className="absolute inset-x-3 bottom-0 h-[3px] rounded-t bg-gradient-to-r from-[#21CC93] to-[#33B1FF]" />}
      </button>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <a href="#contenido" className="sr-only z-[200] rounded-md bg-surface px-3 py-2 text-[13px] font-semibold text-brand shadow focus:not-sr-only focus:fixed focus:top-2 focus:left-2">Saltar al contenido</a>

      <header ref={headerRef} className="no-print relative z-40 shrink-0 text-white" style={{ background: 'var(--fx-masthead)' }}>
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
          <img src={ISOTIPO} alt="" className="absolute -top-16 right-[6%] w-[180px] opacity-[.08] select-none" />
        </div>
        <div className="relative px-4 sm:px-6">
          {/* Fila 1: identidad y contexto */}
          <div className="flex items-center justify-between gap-4 py-4">
            <div className="flex min-w-0 items-center gap-5">
              <img src={LOGO} alt="Fortuner Software Empresarial" width={1400} height={264} className="h-auto w-[170px] shrink-0 sm:w-[220px]" />
              <span className="hidden h-8 w-px bg-white/15 lg:block" />
              <span className="hidden min-w-0 truncate text-lg font-semibold lg:block" title={seccion ? `CRM · ${seccion.label}` : 'CRM'}>
                CRM{seccion && <span className="font-medium text-white/60"> · {seccion.label}</span>}
              </span>
            </div>
            <div className="flex min-w-0 items-center gap-2">
              {sys && <Chip title="Zona comercial del CRM">{sys.zona}</Chip>}
              {sys && !sys.datos && <Chip punto="bad" title="Ejecute la carga de datos del ERP">Sin datos del ERP</Chip>}
              {sys?.etl.corriendo && <Chip punto="warn" title={sys.etl.mensaje}>Cargando datos…</Chip>}
              {sys?.warehouse && (
                <span className="hidden md:inline-flex"><Chip punto={(dias ?? 0) > 2 ? 'warn' : 'mint'}
                  title={`Datos del ERP desde ${fmtFecha(sys.warehouse.fecha_min)} · ${sys.warehouse.clientes_con_compras.toLocaleString('es-CO')} clientes con compras`}>Ventas al {fmtFecha(sys.warehouse.fecha_max)}</Chip></span>
              )}
              {sys && !sys.ia && <span className="hidden md:inline-flex"><Chip punto="warn" title="Falta la API key de DeepSeek en el servidor">IA sin configurar</Chip></span>}
              <button type="button" title={theme === 'dark' ? 'Tema claro' : 'Tema oscuro'} aria-label="Cambiar tema" onClick={toggle}
                className="grid h-10 w-10 shrink-0 place-items-center rounded-[10px] text-white/75 transition-colors hover:bg-white/10 hover:text-white">
                {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
              </button>
            </div>
          </div>

          {/* Fila 2: navegación (los grupos se abren con clic) */}
          <nav aria-label="Navegación principal" className="-mx-4 flex border-t border-white/10 sm:-mx-6 sm:px-2">
            <div className="flex min-w-0 flex-1 gap-0.5 overflow-x-auto px-2 [scrollbar-width:none] sm:px-0">
              {GRUPOS.map((g) => <Pestana key={g.id} g={g} />)}
            </div>
            <div className="shrink-0 pr-2 sm:pr-0"><Pestana g={MAS} /></div>
          </nav>
        </div>

        {grupoAbierto && (
          <div ref={panelRef} role="menu" aria-label={grupoAbierto.label} style={{ left: abierto?.left }}
            className="absolute top-full z-50 mt-1.5 w-60 rounded-[14px] border border-[#E6E9EC] bg-white py-2 text-[#002D49] shadow-[0_20px_40px_-16px_rgba(0,45,73,.45)] max-md:!left-3 max-md:right-3 max-md:w-auto max-md:max-h-[70vh] max-md:overflow-y-auto">
            <div className="px-4 pt-1 pb-1.5 text-[11px] font-semibold tracking-wide text-[#8A97A3] uppercase">{grupoAbierto.id === 'mas' ? 'Próximamente' : grupoAbierto.label}</div>
            {grupoAbierto.opciones.map((o) => {
              const Icon = o.icon
              if (o.proximamente) return (
                <div key={o.id} role="menuitem" aria-disabled="true" title={`${o.label} (en construcción)`} className="flex min-h-9 cursor-not-allowed items-center gap-3 px-4 py-2 text-[13.5px] font-medium text-[#8A97A3]">
                  <Icon size={17} />{o.label}<span className="ml-auto rounded-full border border-[#E6E9EC] bg-[#F7F7F7] px-2 py-0.5 text-[10.5px] font-semibold">Pronto</span>
                </div>)
              const actual = coincide(o, loc.pathname) || (o === opcionActual(grupoAbierto, loc.pathname) && !grupoAbierto.opciones.some((x) => coincide(x, loc.pathname)))
              return (
                <NavLink key={o.id} to={o.to} end={o.end} role="menuitem" onClick={() => setAbierto(null)}
                  className={clsx('flex min-h-9 items-center gap-3 px-4 py-2 text-[13.5px] transition-colors hover:bg-[#F7F7F7]', actual ? 'font-semibold text-[#0F70FC]' : 'font-medium')}>
                  <Icon size={17} className={actual ? 'text-[#0F70FC]' : 'text-[#8A97A3]'} />{o.label}
                </NavLink>)
            })}
          </div>
        )}
      </header>

      <main id="contenido" tabIndex={-1} className="min-w-0 flex-1 overflow-y-auto px-4 py-5 outline-none scroll-thin sm:px-8 sm:py-7">
        {children}
        <footer className="mx-auto mt-10 max-w-[1400px] border-t border-line pt-4 text-[11.5px] text-ink-3">Fortuner 27.0 · Software Empresarial · © 2026 DSI S.A.</footer>
      </main>
    </div>
  )
}
