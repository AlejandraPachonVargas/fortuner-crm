import clsx from 'clsx'
import { Building2, CalendarClock, Image as ImageIcon, Lock, Megaphone, Scale, Settings, SlidersHorizontal, Wallet } from 'lucide-react'
import { useSearchParams } from 'react-router-dom'
import { Notice } from '@/components/ui'
import { useConfigGeneral } from '@/lib/api'
import { Canales } from './Configuracion'
import Fotos from './Fotos'
import { Empresa, Etl, LegalRne, Presupuesto, Reglas } from './General'

const SECCIONES = [
  { id: 'canales', label: 'Canales', icon: Megaphone, C: Canales },
  { id: 'empresa', label: 'Empresa', icon: Building2, C: Empresa },
  { id: 'legal', label: 'Legal y RNE', icon: Scale, C: LegalRne },
  { id: 'reglas', label: 'Reglas de campañas', icon: SlidersHorizontal, C: Reglas },
  { id: 'presupuesto', label: 'Presupuesto', icon: Wallet, C: Presupuesto },
  { id: 'etl', label: 'Carga del ERP', icon: CalendarClock, C: Etl },
  { id: 'fotos', label: 'Fotos de productos', icon: ImageIcon, C: Fotos },
] as const

export default function Configuracion() {
  const [sp, setSp] = useSearchParams()
  const actual = SECCIONES.find((s) => s.id === sp.get('s')) ?? SECCIONES[0]
  const g = useConfigGeneral()
  const C = actual.C
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-brand-soft text-brand"><Settings size={20} /></span>
        <div><h1 className="text-[20px] font-extrabold text-ink">Configuración</h1>
          <p className="text-[12.5px] text-ink-3">Todo lo que personaliza el CRM para su empresa: canales, marca, cumplimiento legal, reglas, presupuesto, datos y fotos.</p></div>
      </div>
      {g.data && !g.data.puede_editar && (
        <Notice tone="info" icon={<Lock size={15} className="mt-0.5 shrink-0" />}>
          Está viendo la configuración en modo consulta. Para cambiarla, cierre esta pestaña y vuelva a entrar con la <b>clave de administración</b>.
        </Notice>
      )}
      <div role="tablist" aria-label="Secciones de Configuración" className="flex flex-wrap gap-x-1 border-b border-line">
        {SECCIONES.map((s) => (
          <button key={s.id} type="button" role="tab" aria-selected={s.id === actual.id} onClick={() => setSp({ s: s.id }, { replace: true })}
            className={clsx('-mb-px flex shrink-0 items-center gap-2 border-b-2 px-3.5 py-2.5 text-[13px] font-semibold transition',
              s.id === actual.id ? 'border-brand text-brand' : 'border-transparent text-ink-3 hover:text-ink')}>
            <s.icon size={15} />{s.label}
          </button>
        ))}
      </div>
      <C />
    </div>
  )
}
