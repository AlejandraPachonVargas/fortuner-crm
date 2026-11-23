import { lazy, Suspense, type ReactNode } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import ApiKeyGate from './components/ApiKeyGate'
import ErrorBoundary from './components/ErrorBoundary'
import { Skeleton } from './components/ui'
import AppShell from './layout/AppShell'
import DetalleAutomatizacion from './pages/automatizaciones/Detalle'
import EdicionEditor from './pages/automatizaciones/EdicionEditor'
import ListaAutomatizaciones, { NuevaAutomatizacion } from './pages/automatizaciones/Lista'
import Detalle from './pages/campanas/Detalle'
import Historial from './pages/campanas/Historial'
import Wizard from './pages/campanas/Wizard'
import Afiliaciones from './pages/clientes/Afiliaciones'
import Calidad from './pages/clientes/Calidad'
import ClienteFicha from './pages/clientes/ClienteFicha'
import ClienteNuevo from './pages/clientes/ClienteNuevo'
import ClientesLista from './pages/clientes/ClientesLista'
import { RolProvider } from './pages/clientes/comun'

// Cada llegada al asistente (otra campaña, «Nueva campaña» o volver a entrar) crea una instancia NUEVA: sin esto React
// reutilizaba el componente y la pantalla seguía mostrando —y al guardar sobrescribía— la campaña anterior.
function WizardRuta() {
  const { key } = useLocation()
  return <Wizard key={key} />
}

// La analítica (ECharts) se carga aparte, solo al abrirla: el resto del CRM no carga ese peso.
const AnaliticaClientes = lazy(() => import('./pages/analitica/Clientes'))
const AnaliticaCampanas = lazy(() => import('./pages/analitica/Campanas'))
const Configuracion = lazy(() => import('./pages/configuracion/Pagina'))
const cargando = <div className="mx-auto max-w-[1400px] space-y-3"><Skeleton h={60} /><Skeleton h={420} /></div>

/** Un fallo de una gráfica (o de descargar el paquete tras una actualización) queda en esa pantalla: el menú sigue vivo. */
function Aislada({ children }: { children: ReactNode }) {
  const { pathname } = useLocation()
  return <ErrorBoundary resetKey={pathname}><Suspense fallback={cargando}>{children}</Suspense></ErrorBoundary>
}

export default function App() {
  return (
    <ApiKeyGate>
      <RolProvider><AppShell>
        <Routes>
          <Route path="/campanas" element={<Historial />} />
          <Route path="/campanas/nueva" element={<WizardRuta />} />
          <Route path="/campanas/:id" element={<Detalle />} />
          <Route path="/campanas/:id/editar" element={<WizardRuta />} />
          <Route path="/clientes" element={<ClientesLista />} />
          <Route path="/clientes/nuevo" element={<ClienteNuevo />} />
          <Route path="/clientes/calidad" element={<Calidad />} />
          <Route path="/clientes/afiliaciones" element={<Afiliaciones />} />
          <Route path="/clientes/:id" element={<ClienteFicha />} />
          <Route path="/automatizaciones" element={<ListaAutomatizaciones />} />
          <Route path="/automatizaciones/nueva" element={<NuevaAutomatizacion />} />
          <Route path="/automatizaciones/:id" element={<DetalleAutomatizacion />} />
          <Route path="/automatizaciones/:id/edicion/:eid" element={<EdicionEditor />} />
          <Route path="/analitica" element={<Navigate to="/analitica/clientes" replace />} />
          <Route path="/analitica/clientes" element={<Aislada><AnaliticaClientes /></Aislada>} />
          <Route path="/analitica/campanas" element={<Aislada><AnaliticaCampanas /></Aislada>} />
          <Route path="/configuracion" element={<Aislada><Configuracion /></Aislada>} />
          <Route path="*" element={<Navigate to="/campanas" replace />} />
        </Routes>
      </AppShell></RolProvider>
    </ApiKeyGate>
  )
}
