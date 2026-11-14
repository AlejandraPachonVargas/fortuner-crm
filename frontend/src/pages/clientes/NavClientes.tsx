import clsx from 'clsx'
import { Database, Lock, RefreshCw, UserPen } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Spinner } from '@/components/ui'
import { getUsuario, setUsuario } from '@/lib/api'
import { fmtFechaHora } from '@/lib/format'
import { useRol } from './comun'
import { op, useSesion } from './datos'
import { ROLES } from './modelo'

/** Franja del módulo: estado de la conexión con ADVANTAGE, quién firma los cambios y vista de prueba.
 *  Las secciones (Clientes, Calidad, Afiliaciones) están en el menú «Clientes 360°» de la cabecera. */
export default function NavClientes() {
  const { rol, rolServidor, vistaLectura, setVistaLectura } = useRol()
  const ses = useSesion().data
  const qc = useQueryClient()
  const [nombre, setNombre] = useState(getUsuario())
  const [recargando, setRecargando] = useState(false)
  const ix = ses?.indice
  // Cuando el servidor termina de releer el ERP (cambia la hora de carga), se refresca todo lo que se ve.
  const cargaVista = useRef<string | null | undefined>(undefined)
  useEffect(() => {
    const t = ix?.cargado_en
    if (cargaVista.current !== undefined && t && t !== cargaVista.current) {
      setRecargando(false)
      void qc.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith('cli-') && q.queryKey[0] !== 'cli-sesion' })
    }
    if (t) cargaVista.current = t
  }, [ix?.cargado_en, qc])
  const recargar = async () => {
    setRecargando(true)
    try { await op.recargarIndice(); void qc.invalidateQueries({ queryKey: ['cli-sesion'] }) } catch { setRecargando(false) }
  }
  return (
    <div className="mb-5 space-y-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-xl border border-[rgba(15,112,252,.25)] bg-[rgba(15,112,252,.08)] px-4 py-2.5 text-[12.5px] text-ink">
        <span className={clsx('h-[7px] w-[7px] shrink-0 rounded-full', ses?.escritura ? 'bg-[#21CC93] shadow-[0_0_0_3px_rgba(33,204,147,.25)]' : 'bg-brand')} aria-hidden="true" />
        <Database size={15} className="shrink-0 text-brand" />
        <span className="min-w-0 flex-1 basis-56">
          <b>Conectado a ADVANTAGE.</b>{' '}
          {!ses ? 'Verificando conexión…' : !ix?.listo ? (ix?.error ? `No se pudo leer el ERP: ${ix.error}` : 'Cargando los clientes del ERP… (unos segundos)')
            : <>Lista leída del ERP el {fmtFechaHora(ix.cargado_en)}{ix.metricas_hasta ? ` · compras hasta ${ix.metricas_hasta}` : ''}. {ses.escritura ? 'Los cambios se guardan directamente en la base (POSCLI y tablas CRM).' : 'Modo solo lectura (CRM_CLIENTES_ESCRITURA desactivado).'}</>}
        </span>
        {ix?.listo && <button type="button" disabled={recargando || ix.cargando} onClick={() => void recargar()} className="inline-flex items-center gap-1 font-semibold text-brand underline disabled:opacity-60">
          {recargando || ix.cargando ? <Spinner size={13} /> : <RefreshCw size={13} />}Releer del ERP</button>}
        {!ses?.escritura && ses && <span className="inline-flex items-center gap-1 font-semibold"><Lock size={13} />Solo lectura</span>}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <label className="ml-auto flex items-center gap-2 text-[12px] text-ink-3" title="Se registra en la auditoría de cada cambio">
          <UserPen size={14} />Firmar cambios como
          <input value={nombre} maxLength={30} onChange={(e) => setNombre(e.target.value)} onBlur={() => setUsuario(nombre.trim())} placeholder="Tu nombre"
            className="h-8 w-36 rounded-[10px] border-[1.5px] border-line-strong bg-surface-2 px-2.5 text-[12.5px] font-semibold text-ink outline-none focus:border-brand focus:bg-surface focus:ring-4 focus:ring-[rgba(15,112,252,.12)]" />
        </label>
        <label className="flex items-center gap-2 text-[12px] text-ink-3">Ver como
          <select value={vistaLectura ? 'lectura' : 'servidor'} onChange={(e) => setVistaLectura(e.target.value === 'lectura')} className="h-8 rounded-[10px] border-[1.5px] border-line-strong bg-surface-2 px-2 text-[12.5px] font-semibold text-ink outline-none focus:border-brand focus:bg-surface" title={ROLES[rol].descripcion}>
            <option value="servidor">{rolServidor ? ROLES[rolServidor].nombre : 'Mi rol'}</option>
            <option value="lectura">{ROLES.lectura.nombre}</option>
          </select></label>
      </div>
    </div>
  )
}
