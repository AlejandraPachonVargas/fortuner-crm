import { Navigate, Route, Routes } from 'react-router-dom'
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

export default function App() {
  return (
    <ApiKeyGate>
      <RolProvider><AppShell>
        <Routes>
          <Route path="/campanas" element={<Historial />} />
          <Route path="/campanas/nueva" element={<Wizard />} />
          <Route path="/campanas/:id" element={<Detalle />} />
          <Route path="/campanas/:id/editar" element={<Wizard />} />
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
