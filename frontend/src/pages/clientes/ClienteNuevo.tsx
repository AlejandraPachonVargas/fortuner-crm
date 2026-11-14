import { ArrowLeft } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { Notice } from '@/components/ui'
import { op, useMutar } from './datos'
import FormCliente, { VACIO } from './FormCliente'

export default function ClienteNuevo() {
  const nav = useNavigate()
  const crear = useMutar(op.crear)
  return (
    <div className="mx-auto max-w-[1300px] space-y-5">
      <button type="button" onClick={() => nav('/clientes')} className="flex items-center gap-1.5 text-[13px] font-semibold text-ink-3 hover:text-ink"><ArrowLeft size={15} />Clientes</button>
      <div><h1 className="text-[24px] font-semibold text-ink">Nuevo cliente</h1><p className="text-[13px] text-ink-3">Se crea directamente en el ERP (POSCLI) con su tarjeta Gana Mercaldas. Mientras más completa la ficha, más campañas podrás dirigirle.</p></div>
      <Notice tone="info">Antes de crear se verifica en el ERP que no exista otro cliente con el mismo documento ni con la misma tarjeta.</Notice>
      <FormCliente inicial={VACIO} modo="crear" onCancelar={() => nav('/clientes')}
        onGuardar={async (d) => {
          try {
            // El departamento se deduce de la ciudad en el servidor; lo vacío no viaja (el ERP lo deja en NULL, como hace la caja).
            const { departamentoId: _dpto, ...resto } = d
            void _dpto
            const datos = Object.fromEntries(Object.entries(resto).filter(([, v]) => v !== '' && v !== null && !(Array.isArray(v) && !v.length)))
            const c = await crear.mutateAsync(datos)
            nav(`/clientes/${encodeURIComponent(c.id)}`, { state: { ok: `Cliente creado en el ERP con la tarjeta ${c.tarjeta}.` } })
          } catch (e) { return e instanceof Error ? e.message : 'No se pudo crear' }
        }} />
    </div>
  )
}
