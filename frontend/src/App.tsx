import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import ApiKeyGate from './components/ApiKeyGate'
import AppShell from './layout/AppShell'
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
          <Route path="*" element={<Navigate to="/campanas" replace />} />
        </Routes>
      </AppShell></RolProvider>
    </ApiKeyGate>
  )
}
