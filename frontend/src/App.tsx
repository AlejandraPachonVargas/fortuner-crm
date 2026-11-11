import { Navigate, Route, Routes } from 'react-router-dom'
import ApiKeyGate from './components/ApiKeyGate'
import AppShell from './layout/AppShell'
import Detalle from './pages/campanas/Detalle'
import Historial from './pages/campanas/Historial'
import Wizard from './pages/campanas/Wizard'

export default function App() {
  return (
    <ApiKeyGate>
      <AppShell>
        <Routes>
          <Route path="/campanas" element={<Historial />} />
          <Route path="/campanas/nueva" element={<Wizard />} />
          <Route path="/campanas/:id" element={<Detalle />} />
          <Route path="/campanas/:id/editar" element={<Wizard />} />
          <Route path="*" element={<Navigate to="/campanas" replace />} />
        </Routes>
      </AppShell>
    </ApiKeyGate>
  )
}
