import clsx from 'clsx'
import { ArrowLeft, Car, ClipboardList, CreditCard, Gift, LayoutDashboard, Megaphone, PawPrint, ShieldAlert, ShoppingBag, Star, UserCog, UserX } from 'lucide-react'
import { useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { Badge, Btn, Card, Empty, ErrorBox, inputCls, Notice, Skeleton, Spinner } from '@/components/ui'
import { fmtNum } from '@/lib/format'
import { Anillo, Avatar, Modal, Pestanas, usePermisos } from './comun'
import { op, useCatalogos, useFicha, useMutar, useReferencias } from './datos'
import FormCliente, { aDatos } from './FormCliente'
import { TabActividad, TabAfiliaciones, TabCompras, TabMascotas, TabResumen, TabVehiculos } from './FichaTabs'
import { SEGMENTOS, TONO_SEGMENTO, nombreCompleto, nombreOpcion, type Cliente } from './modelo'
import { completitud, diferencias } from './validacion'

type Pestana = 'resumen' | 'datos' | 'mascotas' | 'afiliaciones' | 'vehiculos' | 'compras' | 'actividad'

export default function ClienteFicha() {
  const { id = '' } = useParams()
  const nav = useNavigate()
  const loc = useLocation()
  const q = useFicha(id)
  const cat = useCatalogos().data
  const { eliminar, editar } = usePermisos()
  const [tab, setTab] = useState<Pestana>('resumen')
  const [baja, setBaja] = useState(false)
  const [ok, setOk] = useState<string | null>((loc.state as { ok?: string } | null)?.ok ?? null)
  const actualizar = useMutar(op.actualizar, { ficha: (_r, v) => v.id })

  if (q.isLoading) return <div className="mx-auto max-w-[1300px] space-y-4"><Skeleton h={130} /><Skeleton h={320} /></div>
  if (q.error || !q.data) return <div className="mx-auto max-w-3xl space-y-3"><ErrorBox error={q.error ?? new Error('No se encontró ese cliente.')} onRetry={() => void q.refetch()} /><Btn onClick={() => nav('/clientes')}>Volver a la lista</Btn></div>
  const c: Cliente = q.data
  const anon = c.estado === 'anonimizado'
  const nT = c.notasLista.filter((n) => n.tipo === 'tarea' && !n.hecha).length

  return (
    <div className="mx-auto max-w-[1300px] space-y-5">
      <button type="button" onClick={() => nav(-1)} className="flex items-center gap-1.5 text-[13px] font-semibold text-ink-3 hover:text-ink"><ArrowLeft size={15} />Clientes</button>

      <div className="card flex flex-wrap items-center gap-4 p-5">
        <Avatar nombre={nombreCompleto(c)} size={64} anonimo={anon} />
        <div className="min-w-0 flex-1 basis-64">
          <h1 className="flex items-center gap-2 truncate text-[24px] font-semibold text-ink">{nombreCompleto(c)}{q.isFetching && <Spinner size={14} />}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[12.5px] text-ink-3">
            <span>{c.tipoDoc} {c.documento}</span>
            <span className="inline-flex items-center gap-1"><CreditCard size={13} />Tarjeta {c.tarjeta}</span>
            {(nombreOpcion(cat?.ciudades, c.ciudadId) || c.ciudadTexto) && <span>{nombreOpcion(cat?.ciudades, c.ciudadId) || c.ciudadTexto}</span>}
            {c.creado && <span>Cliente desde {new Date(c.creado).getFullYear()}</span>}
            {c.puntos > 0 && <span className="inline-flex items-center gap-1"><Star size={13} />{fmtNum(c.puntos)} puntos</span>}
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <Badge tone={c.estado === 'activo' ? 'good' : c.estado === 'inactivo' ? 'warn' : 'neutral'}>{c.estado === 'activo' ? 'Activo' : c.estado === 'inactivo' ? 'Inactivo' : 'Anonimizado'}</Badge>
            <Badge tone={TONO_SEGMENTO[c.segmento] ?? 'neutral'}>{SEGMENTOS[c.segmento] ?? c.segmento}</Badge>
            <Badge tone={c.consentimiento === 'si' ? 'good' : c.consentimiento === 'no' ? 'bad' : 'warn'}>{c.consentimiento === 'si' ? 'Autoriza datos' : c.consentimiento === 'no' ? 'No autoriza' : 'Sin consentimiento'}</Badge>
            {c.empleado && <Badge tone="brand">Empleado</Badge>}
            {c.bloqueado && <Badge tone="bad">Bloqueado en el POS</Badge>}
            {c.sinCampanas && <Badge tone="warn">No recibe campañas</Badge>}
            {c.origen === 'CRM' && <Badge>Creado desde el CRM</Badge>}
            {c.etiquetas.map((t) => <Badge key={t} tone="brand">{t}</Badge>)}
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-center"><Anillo valor={completitud(c)} size={56} grosor={6} /><div className="mt-1 text-[10.5px] font-semibold tracking-wide text-ink-3 uppercase">Ficha</div></div>
          <div className="flex flex-wrap gap-2">
            <Btn icon={<Megaphone size={15} />} onClick={() => nav('/campanas/nueva')} disabled={anon || c.estado !== 'activo'}>Crear campaña</Btn>
            {editar && c.editable && <Btn variant="primary" icon={<UserCog size={15} />} onClick={() => setTab('datos')}>Editar</Btn>}
            {eliminar && c.editable && <Btn variant="ghost" icon={<UserX size={15} />} onClick={() => setBaja(true)}>Baja</Btn>}
            {!eliminar && editar && c.editable && c.estado === 'activo' && <Btn variant="ghost" icon={<UserX size={15} />} onClick={() => setBaja(true)}>Desactivar</Btn>}
          </div>
        </div>
      </div>

      {ok && <Notice tone="good">{ok} <button type="button" className="ml-2 underline" onClick={() => setOk(null)}>Cerrar</button></Notice>}
      {anon && <Notice tone="info">Este cliente fue anonimizado (Ley 1581): se conservaron la llave y las ventas, pero sus datos personales ya no existen.</Notice>}
      {c.fusionadoEn && <Notice tone="info">Esta ficha se fusionó en otra (tarjeta {c.fusionadoEn}). <button type="button" className="font-semibold underline" onClick={() => nav(`/clientes/${encodeURIComponent(c.fusionadoEn)}`)}>Ir a la ficha que permanece</button></Notice>}
      {c.estado === 'inactivo' && !c.fusionadoEn && <Notice tone="warn">Cliente inactivo{c.motivoEstado ? `: ${c.motivoEstado}` : ''}. No entra en campañas. Sigue existiendo en el ERP y puede seguir comprando.</Notice>}
      {c.avisos.map((a) => <Notice key={a} tone="warn">{a}</Notice>)}

      <Pestanas valor={tab} onChange={setTab} items={[
        { id: 'resumen', label: 'Resumen', icon: <LayoutDashboard size={15} /> }, { id: 'datos', label: 'Datos', icon: <UserCog size={15} /> },
        { id: 'mascotas', label: 'Mascotas', icon: <PawPrint size={15} />, n: c.mascotas.length }, { id: 'afiliaciones', label: 'Afiliaciones', icon: <Gift size={15} />, n: c.afiliaciones.length },
        { id: 'vehiculos', label: 'Vehículos', icon: <Car size={15} />, n: c.vehiculos.length }, { id: 'compras', label: 'Compras', icon: <ShoppingBag size={15} />, n: c.visitas },
        { id: 'actividad', label: 'Actividad', icon: <ClipboardList size={15} />, n: nT || undefined },
      ]} />

      <div role="tabpanel">
        {tab === 'resumen' && <TabResumen c={c} ir={(t) => setTab(t as Pestana)} />}
        {tab === 'datos' && (anon ? <Card><Empty text="Sin datos personales" hint="El cliente fue anonimizado." /></Card> : (
          <FormCliente key={c.version} inicial={aDatos(c)} cliente={c} modo="editar" onCancelar={() => setTab('resumen')}
            onGuardar={async (d) => {
              const cambios = diferencias(aDatos(c), d)
              if (!Object.keys(cambios).length) return 'No hay cambios para guardar.'
              try {
                await actualizar.mutateAsync({ id: c.id, cambios, version: c.version })
                setOk(`Cambios guardados en el ERP (${Object.keys(cambios).length} dato(s)). Quedaron en la auditoría.`); setTab('resumen')
              } catch (e) {
                if (e instanceof Error && /modificó/.test(e.message)) void q.refetch()
                return e instanceof Error ? e.message : 'No se pudo guardar'
              }
            }} />
        ))}
        {tab === 'mascotas' && <TabMascotas c={c} />}
        {tab === 'afiliaciones' && <TabAfiliaciones c={c} />}
        {tab === 'vehiculos' && <TabVehiculos c={c} />}
        {tab === 'compras' && <TabCompras c={c} />}
        {tab === 'actividad' && <TabActividad c={c} />}
      </div>

      {baja && <DialogoBaja c={c} onCerrar={() => setBaja(false)} onHecho={(m) => { setOk(m); setBaja(false) }} />}
    </div>
  )
}

// ------------------------------------------------------------------------------------------ baja: la regla de integridad hecha visible
function DialogoBaja({ c, onCerrar, onHecho }: { c: Cliente; onCerrar: () => void; onHecho: (m: string) => void }) {
  const nav = useNavigate()
  const { eliminar: esAdmin } = usePermisos()
  const ref = useReferencias(c.id, true)
  const [op_, setOp] = useState<'desactivar' | 'anonimizar' | 'eliminar'>('desactivar')
  const [conf, setConf] = useState('')
  const [motivo, setMotivo] = useState('')
  const [err, setErr] = useState('')
  const estado = useMutar(op.estado, { ficha: (_r, v) => v.id })
  const anonimizar = useMutar(op.anonimizar, { ficha: (_r, v) => v })
  const borrar = useMutar(op.eliminar)
  const reactivar = c.estado === 'inactivo'
  const listo = op_ === 'desactivar' || conf === c.documento
  const ocupado = estado.isPending || anonimizar.isPending || borrar.isPending

  const ejecutar = async () => {
    try {
      if (op_ === 'desactivar') { await estado.mutateAsync({ id: c.id, estado: reactivar ? 'activo' : 'inactivo', motivo }); onHecho(reactivar ? 'Cliente reactivado.' : 'Cliente desactivado: sigue en el ERP, puede comprar, pero no entra en campañas. Se puede reactivar.') }
      else if (op_ === 'anonimizar') { await anonimizar.mutateAsync(c.id); onHecho('Cliente anonimizado en el ERP. Se conservaron la llave y las ventas.') }
      else { await borrar.mutateAsync(c.id); nav('/clientes', { state: { ok: 'Cliente eliminado del ERP.' } }) }
      setConf(''); setErr('')
    } catch (e) { setErr(e instanceof Error ? e.message : 'No se pudo completar') }
  }
  const Op = ({ id, titulo, desc, bloqueado, tono }: { id: typeof op_; titulo: string; desc: string; bloqueado?: string; tono?: 'bad' }) => (
    <button type="button" role="radio" aria-checked={op_ === id} disabled={!!bloqueado} onClick={() => { setOp(id); setConf('') }}
      className={clsx('w-full rounded-2xl border p-3.5 text-left transition disabled:cursor-not-allowed disabled:opacity-55', op_ === id ? (tono ? 'border-bad bg-bad-soft' : 'border-brand bg-brand-soft') : 'border-line hover:bg-surface-hover')}>
      <span className="block text-[13.5px] font-bold text-ink">{titulo}</span><span className="block text-[12px] leading-snug text-ink-3">{bloqueado ?? desc}</span>
    </button>
  )
  const r = ref.data
  return (
    <Modal abierto titulo="Dar de baja al cliente" subtitulo={nombreCompleto(c)} onCerrar={onCerrar}
      pie={<><Btn onClick={onCerrar}>Cancelar</Btn><Btn variant={op_ === 'desactivar' ? 'primary' : 'danger'} busy={ocupado} disabled={!listo} onClick={() => void ejecutar()}>{op_ === 'desactivar' ? (reactivar ? 'Reactivar' : 'Desactivar') : op_ === 'anonimizar' ? 'Anonimizar' : 'Eliminar definitivamente'}</Btn></>}>
      <div className="space-y-4">
        <div className="rounded-2xl bg-surface-2 p-3.5 text-[12.5px]">
          <div className="mb-1.5 flex items-center gap-1.5 font-bold text-ink"><ShieldAlert size={14} />Qué depende de este cliente (integridad)</div>
          {!r ? <Spinner /> : <ul className="grid grid-cols-2 gap-x-4 gap-y-1 text-ink-2"><li>Compras en el ERP: <b>{fmtNum(r.compras)}</b></li><li>Puntos: <b>{fmtNum(r.puntos)}</b></li><li>Campañas: <b>{r.campanas}</b></li><li>Mascotas: <b>{r.mascotas}</b></li><li>Afiliaciones: <b>{r.afiliaciones}</b></li><li>Vehículos: <b>{r.vehiculos}</b></li></ul>}
        </div>
        <div role="radiogroup" aria-label="Tipo de baja" className="space-y-2">
          <Op id="desactivar" titulo={reactivar ? 'Reactivar' : 'Desactivar (recomendado)'} desc="Deja de aparecer en campañas y listas activas. En el ERP no cambia nada. Se puede revertir." />
          {esAdmin && <Op id="anonimizar" tono="bad" titulo="Anonimizar (solicitud de supresión)" desc="Borra en el ERP nombre, contacto, dirección, nacimiento y autorizaciones; elimina mascotas, vehículos, clubes y notas. Conserva documento, tarjeta y ventas. No se puede deshacer." />}
          {esAdmin && <Op id="eliminar" tono="bad" titulo="Eliminar definitivamente" desc="Borra el registro de POSCLI. Solo para clientes creados por error desde el CRM y sin ningún movimiento."
            bloqueado={!r ? 'Verificando…' : r.puedeEliminar ? undefined : r.motivoNoEliminar} />}
        </div>
        {op_ === 'desactivar' && !reactivar && <input className={inputCls} value={motivo} maxLength={120} onChange={(e) => setMotivo(e.target.value)} placeholder="Motivo (opcional): ej. se mudó de ciudad" aria-label="Motivo" />}
        {op_ !== 'desactivar' && (
          <div><label className="mb-1 block text-[12px] font-semibold text-ink-2">Para confirmar, escribe el documento <b>{c.documento}</b></label>
            <input className={inputCls} value={conf} onChange={(e) => setConf(e.target.value)} inputMode="numeric" placeholder={c.documento} /></div>
        )}
        {err && <Notice tone="bad">{err}</Notice>}
      </div>
    </Modal>
  )
}
