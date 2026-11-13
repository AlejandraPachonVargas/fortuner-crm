import clsx from 'clsx'
import { Database, Gift, Lock, RefreshCw, ShieldCheck, UserPen, Users } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { NavLink } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { Spinner } from '@/components/ui'
import { getUsuario, setUsuario } from '@/lib/api'
import { fmtFechaHora } from '@/lib/format'
import { useRol } from './comun'
import { op, useSesion } from './datos'
import { ROLES } from './modelo'

/** Barra superior del módulo: estado de la conexión con ADVANTAGE, secciones, quién firma los cambios y vista de prueba. */
export default function NavClientes() {
  const { rol, rolServidor, vistaLectura, setVistaLectura } = useRol()
  const ses = useSesion().data
  const qc = useQueryClient()
  const [nombre, setNombre] = useState(getUsuario())
  const [recargando, setRecargando] = useState(false)
  const it = [{ to: '/clientes', label: 'Clientes', icon: Users, end: true }, { to: '/clientes/calidad', label: 'Calidad de datos', icon: ShieldCheck, end: false }, { to: '/clientes/afiliaciones', label: 'Afiliaciones', icon: Gift, end: false }]
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
      <div className={clsx('flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-2xl border px-4 py-2.5 text-[12.5px]',
        ses?.escritura ? 'border-good/30 bg-good-soft text-good' : 'border-info/30 bg-info-soft text-info')}>
        <Database size={15} className="shrink-0" />
        <span className="min-w-0 flex-1">
          <b>Conectado a ADVANTAGE.</b>{' '}
          {!ses ? 'Verificando conexión…' : !ix?.listo ? (ix?.error ? `No se pudo leer el ERP: ${ix.error}` : 'Cargando los clientes del ERP… (unos segundos)')
            : <>Lista leída del ERP el {fmtFechaHora(ix.cargado_en)}{ix.metricas_hasta ? ` · compras hasta ${ix.metricas_hasta}` : ''}. {ses.escritura ? 'Los cambios se guardan directamente en la base (POSCLI y tablas CRM).' : 'Modo solo lectura (CRM_CLIENTES_ESCRITURA desactivado).'}</>}
        </span>
        {ix?.listo && <button type="button" disabled={recargando || ix.cargando} onClick={() => void recargar()} className="inline-flex items-center gap-1 font-semibold underline disabled:opacity-60">
          {recargando || ix.cargando ? <Spinner size={13} /> : <RefreshCw size={13} />}Releer del ERP</button>}
        {!ses?.escritura && ses && <span className="inline-flex items-center gap-1 font-semibold"><Lock size={13} />Solo lectura</span>}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <nav aria-label="Secciones de clientes" className="inline-flex gap-1 rounded-2xl border border-line bg-surface-2 p-1">
          {it.map((x) => (
            <NavLink key={x.to} to={x.to} end={x.end} className={({ isActive }) => clsx('flex items-center gap-2 rounded-xl px-3.5 py-2 text-[13px] font-semibold transition', isActive ? 'bg-surface text-brand shadow-sm' : 'text-ink-2 hover:text-ink')}><x.icon size={16} />{x.label}</NavLink>
          ))}
        </nav>
        <label className="ml-auto flex items-center gap-2 text-[12px] text-ink-3" title="Se registra en la auditoría de cada cambio">
          <UserPen size={14} />Firmar cambios como
          <input value={nombre} maxLength={30} onChange={(e) => setNombre(e.target.value)} onBlur={() => setUsuario(nombre.trim())} placeholder="Tu nombre"
            className="h-8 w-36 rounded-lg border border-line-strong bg-surface px-2 text-[12.5px] font-semibold text-ink outline-none focus:border-brand" />
        </label>
        <label className="flex items-center gap-2 text-[12px] text-ink-3">Ver como
          <select value={vistaLectura ? 'lectura' : 'servidor'} onChange={(e) => setVistaLectura(e.target.value === 'lectura')} className="h-8 rounded-lg border border-line-strong bg-surface px-2 text-[12.5px] font-semibold text-ink" title={ROLES[rol].descripcion}>
            <option value="servidor">{rolServidor ? ROLES[rolServidor].nombre : 'Mi rol'}</option>
            <option value="lectura">{ROLES.lectura.nombre}</option>
          </select></label>
      </div>
    </div>
  )
}
