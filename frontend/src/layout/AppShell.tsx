import clsx from 'clsx'
import { BarChart3, Megaphone, Moon, PanelLeftClose, PanelLeftOpen, Settings, Sun, Users, Workflow } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { Badge } from '@/components/ui'
import { useGet, type Estado } from '@/lib/api'
import { fmtFecha } from '@/lib/format'

const PROXIMOS = [
  { label: 'Automatizaciones', icon: Workflow },
  { label: 'Analítica de campañas', icon: BarChart3 }, { label: 'Configuración', icon: Settings },
]

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

export default function AppShell({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(() => matchMedia('(min-width: 1024px)').matches)
  const [theme, toggle] = useTheme()
  const loc = useLocation()
  const { data: sys } = useGet<Estado>('/sistema/estado', { stale: 30_000 })
  useEffect(() => { if (!matchMedia('(min-width: 1024px)').matches) setOpen(false) }, [loc.pathname])
  const dias = sys?.warehouse ? Math.floor((Date.now() - new Date(sys.warehouse.fecha_max + 'T00:00:00').getTime()) / 864e5) : null

  return (
    <div className="flex h-full">
      <a href="#contenido" className="sr-only z-[200] rounded-md bg-surface px-3 py-2 text-[13px] font-semibold text-brand shadow focus:not-sr-only focus:fixed focus:top-2 focus:left-2">Saltar al contenido</a>
      {open && <div className="fixed inset-0 z-40 bg-black/40 lg:hidden" onClick={() => setOpen(false)} aria-hidden="true" />}
      <aside className={clsx('no-print flex shrink-0 flex-col bg-[#0b1d36] transition-all duration-200', 'max-lg:fixed max-lg:inset-y-0 max-lg:left-0 max-lg:z-50', open ? 'w-64' : 'w-[64px] max-lg:hidden')}>
        <div className={clsx('flex items-center px-3', open ? 'pt-4 pb-2' : 'h-16 justify-center')}>
          {open ? (
            <div className="w-full">
              <div className="rounded-xl bg-white px-3 py-2 shadow"><img src="/logo-dsi.png" alt="DSI S.A." className="h-auto w-full" /></div>
              <div className="mt-1.5 text-center text-[10.5px] font-medium tracking-wide text-[#8c98ab]">CRM del ERP FORTUNER</div>
            </div>
          ) : <div className="grid h-10 w-10 place-items-center rounded-xl bg-white p-1 shadow"><img src="/logo-dsi-icono.png" alt="DSI S.A." className="h-full w-full object-contain" /></div>}
        </div>
        <nav aria-label="Navegación principal" className="flex-1 overflow-y-auto px-2 pb-3 scroll-thin">
          {open && <div className="mt-3 px-2 py-1 text-[11px] font-bold tracking-wider text-[#6f8fb5] uppercase">Marketing</div>}
          <NavLink to="/campanas" title="Campañas" className={({ isActive }) => clsx('mt-1 mb-0.5 flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] font-medium transition', isActive ? 'bg-accent text-white shadow' : 'text-[#c1cad8] hover:bg-white/5 hover:text-white')}>
            <Megaphone size={17} className="shrink-0" />{open && <span>Campañas</span>}
          </NavLink>
          <NavLink to="/clientes" title="Clientes 360°" className={({ isActive }) => clsx('mb-0.5 flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] font-medium transition', isActive ? 'bg-accent text-white shadow' : 'text-[#c1cad8] hover:bg-white/5 hover:text-white')}>
            <Users size={17} className="shrink-0" />{open && <span>Clientes 360°</span>}
          </NavLink>
          {open && <div className="mt-4 px-2 py-1 text-[11px] font-bold tracking-wider text-[#6f8fb5] uppercase">Próximamente</div>}
          {PROXIMOS.map((p) => (
            <div key={p.label} title={`${p.label} (en construcción)`} aria-disabled="true" className="mb-0.5 flex cursor-not-allowed items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] font-medium text-[#56647a]">
              <p.icon size={17} className="shrink-0" />{open && <span className="truncate">{p.label}</span>}
            </div>
          ))}
        </nav>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="no-print sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-line bg-surface/95 px-4 backdrop-blur">
          <button type="button" aria-label="Menú" title="Menú" onClick={() => setOpen(!open)} className="grid h-8 w-8 place-items-center rounded-lg text-ink-2 hover:bg-surface-hover">{open ? <PanelLeftClose size={17} /> : <PanelLeftOpen size={17} />}</button>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[15px] font-bold text-ink">{loc.pathname.startsWith('/clientes') ? 'Clientes 360°' : 'Campañas'}</div>
            <div className="truncate text-[11.5px] text-ink-3">{loc.pathname.startsWith('/clientes') ? 'Ficha, calidad de datos y afiliaciones de cada cliente' : 'Productos, mensaje con IA y audiencia segmentada'}{sys ? ` · ${sys.zona}` : ''}</div>
          </div>
          {sys && !sys.datos && <Badge tone="bad" title="Ejecute la carga de datos del ERP">Sin datos del ERP</Badge>}
          {sys?.etl.corriendo && <Badge tone="warn" title={sys.etl.mensaje}>Cargando datos…</Badge>}
          {sys?.warehouse && (
            <span title={`Datos del ERP desde ${fmtFecha(sys.warehouse.fecha_min)} · ${sys.warehouse.clientes_con_compras.toLocaleString('es-CO')} clientes con compras`}
              className={clsx('hidden items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11.5px] font-medium md:flex', (dias ?? 0) > 2 ? 'border-warn/30 bg-warn-soft text-warn' : 'border-good/30 bg-good-soft text-good')}>
              <span className={clsx('h-1.5 w-1.5 rounded-full', (dias ?? 0) > 2 ? 'bg-warn' : 'bg-good')} />Ventas al {fmtFecha(sys.warehouse.fecha_max)}
            </span>
          )}
          {sys && !sys.ia && <Badge tone="warn" title="Falta la API key de DeepSeek en el servidor">IA sin configurar</Badge>}
          <button type="button" title={theme === 'dark' ? 'Tema claro' : 'Tema oscuro'} aria-label="Cambiar tema" onClick={toggle} className="grid h-8 w-8 place-items-center rounded-lg text-ink-2 hover:bg-surface-hover">{theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}</button>
        </header>
        <main id="contenido" tabIndex={-1} className="min-w-0 flex-1 overflow-y-auto p-4 outline-none scroll-thin md:p-5">{children}</main>
      </div>
    </div>
  )
}
