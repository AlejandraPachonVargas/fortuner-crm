import clsx from 'clsx'
import { CalendarClock, Car, CheckCircle2, CircleAlert, ClipboardList, Database, Gift, Mail, MessageCircle, MessageSquareText, Pencil, PawPrint, Plus, Receipt, ShoppingBag, Trash2, Wallet } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Badge, Bars, Btn, Card, Empty, IconBtn, inputCls, Notice, Skeleton, Stat } from '@/components/ui'
import { DIAS, fmtCop, fmtFecha, fmtNum } from '@/lib/format'
import { Anillo, Campo, Modal, selectCls, usePermisos } from './comun'
import { ETIQUETA_CAMPO, HOY_ISO, op, proximaRecompra, useCambios, useCampanasCliente, useCatalogos, useCompras, useMutar } from './datos'
import { CICLOS, MARCAS_VEHICULO, RAZAS, SEGMENTOS, TONO_SEGMENTO, type Cliente, type Mascota, type Vehiculo } from './modelo'
import { completitud, contactable, faltantes } from './validacion'

const dias = (iso: string | null) => (iso ? Math.round((Date.now() - new Date(iso + 'T00:00:00').getTime()) / 864e5) : null)
export const edadMascota = (nac: string | null) => {
  if (!nac) return 'Edad sin dato'
  const m = Math.max(0, Math.floor((Date.now() - new Date(nac).getTime()) / (30.44 * 864e5)))
  return m < 12 ? `${m} mes(es)` : `${Math.floor(m / 12)} año(s)${m % 12 ? ` y ${m % 12} m` : ''}`
}
const Origen = ({ o }: { o: string }) => (o === 'POSCLI' ? <Badge title="Migrado desde las columnas de POSCLI el día de la instalación">Del POS</Badge> : null)

// ------------------------------------------------------------------------------------------ resumen
export function TabResumen({ c, ir }: { c: Cliente; ir: (t: string) => void }) {
  const cat = useCatalogos().data
  const puntaje = completitud(c), falta = faltantes(c), canal = contactable(c)
  const ult = dias(c.ultimaCompra), prox = proximaRecompra(c)
  const dProx = prox ? Math.round((new Date(prox).getTime() - Date.now()) / 864e5) : null
  const afis = cat?.afiliaciones ?? []
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
        <Stat label="Visitas" value={fmtNum(c.visitas)} sub={c.metricasHasta ? `hasta ${fmtFecha(c.metricasHasta)}` : undefined} />
        <Stat label="Venta total" value={fmtCop(c.ventaTotal)} />
        <Stat label="Ticket promedio" value={c.visitas ? fmtCop(c.ticketProm) : '—'} />
        <Stat label="Última compra" value={ult == null ? '—' : ult === 0 ? 'Hoy' : `Hace ${ult} d`} sub={c.ultimaCompra ? fmtFecha(c.ultimaCompra) : 'Sin compras'} />
        <Stat label="Próxima recompra" value={dProx == null ? '—' : dProx < 0 ? `Atrasado ${-dProx} d` : `En ${dProx} d`} tone={dProx != null && dProx < 0 ? 'warn' : undefined} sub={prox ? fmtFecha(prox) : undefined} />
      </div>
      <div className="grid items-stretch gap-5 lg:grid-cols-3">
        <Card title="Segmento" subtitle="Calculado a partir de sus compras">
          <Badge tone={TONO_SEGMENTO[c.segmento] ?? 'neutral'}>{SEGMENTOS[c.segmento] ?? c.segmento}</Badge>
          <p className="mt-2 text-[12.5px] text-ink-2">{CICLOS[c.ciclo] ?? c.ciclo}{c.intervaloDias ? ` · suele comprar cada ${c.intervaloDias} días` : ''}.</p>
          {(c.diaPreferido || c.franjaPreferida) && <p className="mt-1 text-[12.5px] text-ink-2">Suele venir {c.diaPreferido ? `los ${DIAS[c.diaPreferido]?.toLowerCase()}` : ''}{c.franjaPreferida ? ` en la ${c.franjaPreferida}` : ''}.</p>}
          {c.fusionados.length > 0 && <p className="mt-2 text-[12px] text-ink-3">Incluye las compras de {c.fusionados.length} ficha(s) fusionada(s).</p>}
          <div className="mt-4 flex flex-wrap gap-1.5">{c.etiquetas.length ? c.etiquetas.map((t) => <Badge key={t} tone="brand">{t}</Badge>) : <span className="text-[12px] text-ink-3">Sin etiquetas</span>}</div>
        </Card>
        <Card title="Contacto autorizado" subtitle={c.consentimiento === 'si' ? `Autorizó el tratamiento de datos${c.consentFecha ? ` el ${fmtFecha(c.consentFecha)}` : ''}` : c.consentimiento === 'no' ? 'No autorizó: no contactar' : 'Sin registro de consentimiento'}>
          <ul className="space-y-2 text-[12.5px]">
            {([['whatsapp', 'WhatsApp', MessageCircle], ['sms', 'SMS', MessageSquareText], ['email', 'Correo', Mail]] as const).map(([k, l, I]) => (
              <li key={k} className="flex items-center gap-2"><I size={15} className="text-ink-3" /><span className="text-ink-2">{l}</span>
                {canal[k] ? <span className="ml-auto flex items-center gap-1 font-semibold text-good"><CheckCircle2 size={14} />Sí</span> : <span className="ml-auto font-semibold text-ink-3">No</span>}</li>
            ))}
          </ul>
          {c.consentMedio && <p className="mt-3 text-[11.5px] text-ink-3">Medio: {c.consentMedio}</p>}
        </Card>
        <Card title="Calidad de la ficha" actions={<Anillo valor={puntaje} />}>
          {falta.length === 0 ? <p className="text-[12.5px] text-good">Ficha completa.</p> : (
            <>
              <ul className="space-y-1.5">{falta.slice(0, 4).map((f) => <li key={f.campo} className="flex items-center gap-2 text-[12.5px] text-ink-2"><CircleAlert size={13} className="shrink-0 text-warn" />{f.etiqueta}</li>)}</ul>
              {c.editable && <Btn small variant="secondary" className="mt-3" onClick={() => ir('datos')}>Completar datos</Btn>}
            </>
          )}
        </Card>
      </div>
      <div className="grid items-stretch gap-5 lg:grid-cols-2">
        <Card icon={<PawPrint size={18} />} title="Mascotas" actions={<Btn small variant="ghost" onClick={() => ir('mascotas')}>Ver todas</Btn>}>
          {c.mascotas.length === 0 ? <p className="text-[12.5px] text-ink-3">Sin mascotas registradas.</p> : (
            <div className="flex flex-wrap gap-2">{c.mascotas.map((m) => <span key={m.id} className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface-2 px-3 py-1 text-[12.5px]"><PawPrint size={13} className="text-brand" /><b>{m.nombre || 'Sin nombre'}</b><span className="text-ink-3">{m.tipo}</span></span>)}</div>
          )}
        </Card>
        <Card icon={<Gift size={18} />} title="Afiliaciones" actions={<Btn small variant="ghost" onClick={() => ir('afiliaciones')}>Ver todas</Btn>}>
          {c.afiliaciones.length === 0 ? <p className="text-[12.5px] text-ink-3">No pertenece a ningún club.</p> : (
            <div className="flex flex-wrap gap-2">{c.afiliaciones.map((s) => { const a = afis.find((x) => x.id === s.afiliacionId); return a ? <span key={s.id} className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[12.5px] font-semibold text-white" style={{ background: a.color }}>{a.nombre}{s.estado !== 'activa' && <span className="opacity-80">· {s.estado}</span>}</span> : null })}</div>
          )}
        </Card>
      </div>
    </div>
  )
}

// ------------------------------------------------------------------------------------------ mascotas
export function TabMascotas({ c }: { c: Cliente }) {
  const cat = useCatalogos().data
  const { editar: puede } = usePermisos()
  const editar = puede && c.editable
  const tipos = (cat?.tiposMascota ?? []).filter((t) => t.id !== '01')
  const [f, setF] = useState<Partial<Mascota> | null>(null)
  const [err, setErr] = useState('')
  const guardarM = useMutar(op.mascota, { ficha: (_r, v) => v.id })
  const borrarM = useMutar(op.borrarMascota, { ficha: (_r, v) => v.id })
  const tipoNombre = tipos.find((t) => t.id === f?.tipoId)?.nombre ?? ''
  const guardar = async () => {
    if (!f?.nombre?.trim()) { setErr('Escriba el nombre de la mascota.'); return }
    try {
      await guardarM.mutateAsync({ id: c.id, m: { id: f.id, tipoId: f.tipoId, nombre: f.nombre.trim(), raza: f.raza ?? '', nacimiento: f.nacimiento ?? null, sexo: f.sexo ?? 'N', notas: f.notas ?? '' } })
      setF(null); setErr('')
    } catch (e) { setErr(e instanceof Error ? e.message : 'No se pudo guardar') }
  }
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3"><p className="flex-1 text-[13px] text-ink-3">Un cliente puede tener varias mascotas (tabla <b>CRM_MASCOTA</b>, tipo según <b>GANMASCOTA</b>). La primera se refleja en POSCLI para que la caja la siga viendo.</p>
        {editar && <Btn variant="primary" icon={<Plus size={15} />} onClick={() => { setF({ tipoId: '02', raza: '', sexo: 'N' }); setErr('') }}>Agregar mascota</Btn>}</div>
      {c.mascotas.length === 0 ? <Card><Empty text="Sin mascotas" hint="Agrega la primera para activar campañas del Club Mascotas." /></Card> : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {c.mascotas.map((m) => (
            <div key={m.id} className="card flex items-start gap-3 p-4">
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-brand-soft text-brand"><PawPrint size={21} /></span>
              <div className="min-w-0 flex-1"><div className="truncate text-[14.5px] font-bold text-ink">{m.nombre || 'Sin nombre'}</div><div className="text-[12px] text-ink-3">{m.tipo} · {m.raza || 'Raza sin dato'}</div>
                <div className="mt-1.5 flex flex-wrap gap-1.5"><Badge>{edadMascota(m.nacimiento)}</Badge><Badge>{m.sexo === 'H' ? 'Hembra' : m.sexo === 'M' ? 'Macho' : 'Sexo sin dato'}</Badge><Origen o={m.origen} /></div></div>
              {editar && <div className="flex"><IconBtn title="Editar" onClick={() => { setF(m); setErr('') }}><Pencil size={15} /></IconBtn><IconBtn title="Quitar" danger onClick={() => { if (confirm(`¿Quitar a ${m.nombre || 'esta mascota'}?`)) borrarM.mutate({ id: c.id, mid: m.id }) }}><Trash2 size={15} /></IconBtn></div>}
            </div>
          ))}
        </div>
      )}
      <Modal abierto={!!f} titulo={f?.id ? 'Editar mascota' : 'Nueva mascota'} subtitulo={`Cliente: ${c.nombres} ${c.apellidos}`} onCerrar={() => setF(null)}
        pie={<><Btn onClick={() => setF(null)}>Cancelar</Btn><Btn variant="primary" busy={guardarM.isPending} onClick={() => void guardar()}>Guardar</Btn></>}>
        {f && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Campo etiqueta="Nombre" requerido error={err}><input className={inputCls} value={f.nombre ?? ''} maxLength={40} onChange={(e) => setF({ ...f, nombre: e.target.value })} /></Campo>
            <Campo etiqueta="Tipo (GANMASCOTA)"><select className={selectCls} value={f.tipoId} onChange={(e) => setF({ ...f, tipoId: e.target.value, raza: '' })}>{tipos.map((t) => <option key={t.id} value={t.id}>{t.nombre}</option>)}</select></Campo>
            <Campo etiqueta="Raza"><input className={inputCls} list="razas-mascota" value={f.raza ?? ''} maxLength={40} onChange={(e) => setF({ ...f, raza: e.target.value })} placeholder="Escriba o elija" />
              <datalist id="razas-mascota">{(RAZAS[tipoNombre] ?? []).map((r) => <option key={r} value={r} />)}</datalist></Campo>
            <Campo etiqueta="Sexo"><select className={selectCls} value={f.sexo} onChange={(e) => setF({ ...f, sexo: e.target.value as Mascota['sexo'] })}><option value="N">Sin dato</option><option value="H">Hembra</option><option value="M">Macho</option></select></Campo>
            <Campo etiqueta="Fecha de nacimiento" ayuda={f.nacimiento ? edadMascota(f.nacimiento) : 'Mejor la fecha que la edad: la edad se desactualiza.'}><input type="date" className={inputCls} value={f.nacimiento ?? ''} max={HOY_ISO} onChange={(e) => setF({ ...f, nacimiento: e.target.value || null })} /></Campo>
            <Campo etiqueta="Notas"><input className={inputCls} value={f.notas ?? ''} maxLength={120} onChange={(e) => setF({ ...f, notas: e.target.value })} placeholder="Alergias, alimento preferido…" /></Campo>
          </div>
        )}
      </Modal>
    </div>
  )
}

// ------------------------------------------------------------------------------------------ afiliaciones
export function TabAfiliaciones({ c }: { c: Cliente }) {
  const cat = useCatalogos().data
  const { editar: puede } = usePermisos()
  const editar = puede && c.editable
  const afis = cat?.afiliaciones ?? []
  const [nuevo, setNuevo] = useState<{ afiliacionId: string; ingreso: string } | null>(null)
  const [err, setErr] = useState('')
  const guardarS = useMutar(op.socio, { ficha: (_r, v) => v.id })
  const borrarS = useMutar(op.borrarSocio, { ficha: (_r, v) => v.id })
  const disponibles = afis.filter((a) => a.activa && !c.afiliaciones.some((s) => s.afiliacionId === a.id && s.estado !== 'vencida'))
  const guardar = async () => {
    if (!nuevo?.afiliacionId) { setErr('Elija el club.'); return }
    try { await guardarS.mutateAsync({ id: c.id, s: nuevo }); setNuevo(null); setErr('') } catch (e) { setErr(e instanceof Error ? e.message : 'No se pudo guardar') }
  }
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3"><p className="flex-1 text-[13px] text-ink-3">Un cliente puede pertenecer a varios clubes (tabla <b>CRM_AFILIACION_CLIENTE</b>). En los 5 clubes históricos también se actualiza la bandera de POSCLI que usa la caja para los descuentos.</p>
        {editar && <Btn variant="primary" icon={<Plus size={15} />} disabled={!disponibles.length} onClick={() => { setNuevo({ afiliacionId: disponibles[0]?.id ?? '', ingreso: HOY_ISO }); setErr('') }}>Afiliar a un club</Btn>}</div>
      {c.afiliaciones.length === 0 ? <Card><Empty text="No pertenece a ningún club" /></Card> : (
        <div className="grid gap-4 sm:grid-cols-2">
          {c.afiliaciones.map((s) => {
            const a = afis.find((x) => x.id === s.afiliacionId)
            return (
              <div key={s.id} className="card overflow-hidden">
                <div className="flex items-center gap-3 px-4 py-3 text-white" style={{ background: a?.color ?? '#64748b' }}>
                  <Gift size={18} /><div className="min-w-0 flex-1"><div className="truncate text-[14px] font-bold">{a?.nombre ?? 'Club'}</div><div className="text-[11.5px] opacity-85">{s.carnet ? `Carné ${s.carnet}` : 'Sin carné'}</div></div>
                  <span className="rounded-full bg-white/20 px-2 py-0.5 text-[11px] font-bold capitalize">{s.estado}</span>
                </div>
                <div className="flex flex-wrap items-center gap-3 px-4 py-3 text-[12.5px]">
                  <div className="text-ink-2"><div>Ingreso: <b>{s.ingreso ? fmtFecha(s.ingreso) : 'sin dato'}</b></div><div>Vence: <b>{s.vence ? fmtFecha(s.vence) : 'no vence'}</b></div></div>
                  <Origen o={s.origen} />
                  {editar && <div className="ml-auto flex">
                    {s.estado !== 'activa' ? <Btn small onClick={() => guardarS.mutate({ id: c.id, s: { id: s.id, estado: 'activa' } })}>Reactivar</Btn> : <Btn small variant="ghost" onClick={() => guardarS.mutate({ id: c.id, s: { id: s.id, estado: 'suspendida' } })}>Suspender</Btn>}
                    <IconBtn title="Quitar del club" danger onClick={() => { if (confirm(`¿Quitar del ${a?.nombre ?? 'club'}?`)) borrarS.mutate({ id: c.id, sid: s.id }) }}><Trash2 size={15} /></IconBtn></div>}
                </div>
              </div>
            )
          })}
        </div>
      )}
      {(guardarS.error || borrarS.error) && <Notice tone="bad">{(guardarS.error ?? borrarS.error)?.message}</Notice>}
      <Modal abierto={!!nuevo} titulo="Afiliar a un club" subtitulo={`Cliente: ${c.nombres} ${c.apellidos}`} onCerrar={() => setNuevo(null)} pie={<><Btn onClick={() => setNuevo(null)}>Cancelar</Btn><Btn variant="primary" busy={guardarS.isPending} onClick={() => void guardar()}>Afiliar</Btn></>}>
        {nuevo && (
          <div className="space-y-4">
            <Campo etiqueta="Club" requerido><select className={selectCls} value={nuevo.afiliacionId} onChange={(e) => setNuevo({ ...nuevo, afiliacionId: e.target.value })}>{disponibles.map((a) => <option key={a.id} value={a.id}>{a.nombre}</option>)}</select></Campo>
            <Campo etiqueta="Fecha de ingreso"><input type="date" className={inputCls} value={nuevo.ingreso} max={HOY_ISO} onChange={(e) => setNuevo({ ...nuevo, ingreso: e.target.value })} /></Campo>
            {afis.find((a) => a.id === nuevo.afiliacionId)?.beneficios && <p className="rounded-lg bg-surface-2 px-3 py-2 text-[12px] text-ink-3">{afis.find((a) => a.id === nuevo.afiliacionId)?.beneficios}</p>}
            {err && <Notice tone="bad">{err}</Notice>}
          </div>
        )}
      </Modal>
    </div>
  )
}

// ------------------------------------------------------------------------------------------ vehículos
export function TabVehiculos({ c }: { c: Cliente }) {
  const cat = useCatalogos().data
  const { editar: puede } = usePermisos()
  const editar = puede && c.editable
  const [f, setF] = useState<Partial<Vehiculo> | null>(null)
  const [err, setErr] = useState('')
  const guardarV = useMutar(op.vehiculo, { ficha: (_r, v) => v.id })
  const borrarV = useMutar(op.borrarVehiculo, { ficha: (_r, v) => v.id })
  const guardar = async () => {
    const placa = (f?.placa ?? '').trim().toUpperCase()
    if (placa && !/^[A-Z]{3}\d{2}[A-Z0-9]$/.test(placa)) { setErr('La placa debe verse como ABC123 (o ABC12D en moto). Puede dejarla vacía.'); return }
    try {
      await guardarV.mutateAsync({ id: c.id, x: { id: f?.id, tipo: f?.tipo ?? 'Automóvil', marca: f?.marca ?? '', linea: f?.linea ?? '', placa, anio: f?.anio ?? null } })
      setF(null); setErr('')
    } catch (e) { setErr(e instanceof Error ? e.message : 'No se pudo guardar') }
  }
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3"><p className="flex-1 text-[13px] text-ink-3">Tabla <b>CRM_VEHICULO</b>. El tipo principal se refleja en POSCLI con el código de <b>GANAUTOS</b>. Útil para ofertas de lubricantes y accesorios.</p>
        {editar && <Btn variant="primary" icon={<Plus size={15} />} onClick={() => { setF({ tipo: 'Automóvil', marca: 'Chevrolet' }); setErr('') }}>Agregar vehículo</Btn>}</div>
      {c.vehiculos.length === 0 ? <Card><Empty text="Sin vehículos registrados" /></Card> : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {c.vehiculos.map((v) => (
            <div key={v.id} className="card flex items-start gap-3 p-4">
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-surface-2 text-ink-2"><Car size={21} /></span>
              <div className="min-w-0 flex-1"><div className="text-[14.5px] font-bold text-ink">{v.tipo}{v.marca ? ` · ${v.marca}` : ''} {v.linea}</div><div className="text-[12px] text-ink-3">{v.anio ?? 'Año sin dato'}</div>
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">{v.placa ? <span className="inline-block rounded-md border-2 border-ink/80 bg-[#ffd400] px-2 py-0.5 text-[12px] font-extrabold tracking-widest text-black">{v.placa}</span> : <Badge>Sin placa</Badge>}<Origen o={v.origen} /></div></div>
              {editar && <div className="flex"><IconBtn title="Editar" onClick={() => { setF(v); setErr('') }}><Pencil size={15} /></IconBtn><IconBtn title="Quitar" danger onClick={() => { if (confirm('¿Quitar este vehículo?')) borrarV.mutate({ id: c.id, vid: v.id }) }}><Trash2 size={15} /></IconBtn></div>}
            </div>
          ))}
        </div>
      )}
      <Modal abierto={!!f} titulo={f?.id ? 'Editar vehículo' : 'Nuevo vehículo'} onCerrar={() => setF(null)} pie={<><Btn onClick={() => setF(null)}>Cancelar</Btn><Btn variant="primary" busy={guardarV.isPending} onClick={() => void guardar()}>Guardar</Btn></>}>
        {f && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Campo etiqueta="Tipo"><select className={selectCls} value={f.tipo} onChange={(e) => setF({ ...f, tipo: e.target.value })}>{(cat?.tiposVehiculo ?? ['Automóvil']).map((t) => <option key={t}>{t}</option>)}</select></Campo>
            <Campo etiqueta="Marca"><select className={selectCls} value={f.marca} onChange={(e) => setF({ ...f, marca: e.target.value })}><option value="">Sin dato</option>{MARCAS_VEHICULO.map((t) => <option key={t}>{t}</option>)}</select></Campo>
            <Campo etiqueta="Línea / modelo"><input className={inputCls} value={f.linea ?? ''} maxLength={30} onChange={(e) => setF({ ...f, linea: e.target.value })} /></Campo>
            <Campo etiqueta="Año"><input className={inputCls} inputMode="numeric" value={f.anio ?? ''} maxLength={4} onChange={(e) => setF({ ...f, anio: Number(e.target.value.replace(/\D/g, '')) || null })} /></Campo>
            <div className="sm:col-span-2"><Campo etiqueta="Placa" error={err}><input className={inputCls} value={f.placa ?? ''} maxLength={6} onChange={(e) => setF({ ...f, placa: e.target.value.toUpperCase() })} placeholder="ABC123 (opcional)" /></Campo></div>
          </div>
        )}
      </Modal>
    </div>
  )
}

// ------------------------------------------------------------------------------------------ compras (warehouse, solo lectura)
export function TabCompras({ c }: { c: Cliente }) {
  const q = useCompras(c.id, 20)
  return (
    <div className="space-y-5">
      <Notice tone="info" icon={<Receipt size={15} className="mt-0.5 shrink-0" />}>Compras leídas del ERP (FADITE), por documento y por tarjeta{c.fusionados.length ? ', incluidas las fichas fusionadas' : ''}. Solo lectura{q.data?.metricasHasta ? `; datos hasta ${fmtFecha(q.data.metricasHasta)}` : ''}.</Notice>
      {q.isLoading ? <Skeleton h={260} /> : !q.data?.compras.length ? <Card><Empty text="Sin compras en el periodo cargado" hint="El CRM carga los últimos meses de ventas del ERP (CRM_ETL_MESES)." /></Card> : (
        <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
          <Card icon={<ShoppingBag size={18} />} title="Últimas compras" pad={false}>
            <div className="overflow-x-auto"><table className="w-full min-w-[520px] text-left text-[12.5px]">
              <thead className="border-y border-line text-ink-3"><tr><th className="px-5 py-2 font-semibold">Fecha</th><th className="px-2 py-2 font-semibold">Factura</th><th className="px-2 py-2 font-semibold">Sede</th><th className="px-2 py-2 font-semibold">Producto principal</th><th className="px-2 py-2 text-right font-semibold">Líneas</th><th className="px-5 py-2 text-right font-semibold">Total</th></tr></thead>
              <tbody className="divide-y divide-line">{q.data.compras.map((x) => (
                <tr key={`${x.ticket}-${x.fecha}`}><td className="px-5 py-2.5">{fmtFecha(x.fecha)}</td><td className="px-2 py-2.5 text-ink-3">{x.ticket}</td><td className="px-2 py-2.5">{x.sede}</td><td className="max-w-48 truncate px-2 py-2.5 text-ink-2">{x.productos[0] ?? ''}</td><td className="px-2 py-2.5 text-right tnum">{x.lineas}</td><td className="px-5 py-2.5 text-right font-semibold tnum">{fmtCop(x.total)}</td></tr>))}</tbody>
            </table></div>
          </Card>
          <Card icon={<Wallet size={18} />} title="Lo que más compra" subtitle="Número de compras por producto"><Bars rows={q.data.top.map((t) => ({ label: t.nombre, n: t.n }))} /></Card>
        </div>
      )}
    </div>
  )
}

// ------------------------------------------------------------------------------------------ actividad
type TipoEv = 'compra' | 'campana' | 'cambio' | 'nota'
interface Evento { ts: string; tipo: TipoEv; titulo: string; detalle?: string; autor?: string }
const ICONO_EV: Record<TipoEv, typeof Receipt> = { compra: ShoppingBag, campana: MessageCircle, cambio: Database, nota: ClipboardList }
const COLOR_EV: Record<TipoEv, string> = { compra: 'bg-good-soft text-good', campana: 'bg-brand-soft text-brand', cambio: 'bg-warn-soft text-warn', nota: 'bg-surface-2 text-ink-2' }
const ACCION: Record<string, string> = { editar: 'Edición', crear: 'Creación', eliminar: 'Eliminación', sincronizar: 'Sincronización con el POS', fusionar: 'Fusión', anonimizar: 'Anonimización', desactivar: 'Desactivación', reactivar: 'Reactivación', importar: 'Importación', etiquetar: 'Etiqueta', corregir: 'Corrección' }
const valor = (v: string) => (v === 'True' ? 'Sí' : v === 'False' ? 'No' : v)

export function TabActividad({ c }: { c: Cliente }) {
  const { editar: puede } = usePermisos()
  const editar = puede && c.editable
  const compras = useCompras(c.id, 20).data?.compras ?? []
  const camps = useCampanasCliente(c.id).data ?? []
  const cambios = useCambios(c.id).data ?? []
  const [filtro, setFiltro] = useState<TipoEv | ''>('')
  const [texto, setTexto] = useState('')
  const [tipo, setTipo] = useState<'nota' | 'tarea'>('nota')
  const [vence, setVence] = useState('')
  const nota = useMutar(op.nota, { ficha: (_r, v) => v.id })
  const alternar = useMutar(op.alternarNota, { ficha: (_r, v) => v.id })
  const borrar = useMutar(op.borrarNota, { ficha: (_r, v) => v.id })
  const eventos = useMemo<Evento[]>(() => [
    ...compras.map((x) => ({ ts: x.fecha, tipo: 'compra' as const, titulo: `Compra ${x.ticket} · ${fmtCop(x.total)}`, detalle: [x.sede, x.productos[0]].filter(Boolean).join(' · ') })),
    ...camps.map((x) => ({ ts: x.fecha, tipo: 'campana' as const, titulo: `${x.nombre}${x.grupo === 'control' ? ' (grupo de control)' : ''}`, detalle: `${x.estado} · ${x.canales}` })),
    ...cambios.map((x) => ({ ts: x.ts, tipo: 'cambio' as const, titulo: `${ACCION[x.accion] ?? x.accion} · ${ETIQUETA_CAMPO[x.campo] ?? x.campo}${x.estado !== 'aplicado' ? ` (${x.estado})` : ''}`,
      detalle: x.antes || x.despues ? `${valor(x.antes) || '—'}  →  ${valor(x.despues) || '—'}` : undefined, autor: x.autor.split('@')[0] })),
    ...c.notasLista.map((x) => ({ ts: x.fecha ?? '', tipo: 'nota' as const, titulo: x.tipo === 'tarea' ? `Tarea${x.vence ? ` para ${fmtFecha(x.vence)}` : ''}${x.hecha ? ' · hecha' : ''}` : 'Nota', detalle: x.texto, autor: x.autor.split('@')[0] })),
  ].sort((a, b) => b.ts.localeCompare(a.ts)), [compras, camps, cambios, c.notasLista])
  const vistos = filtro ? eventos.filter((e) => e.tipo === filtro) : eventos
  const agregar = async () => { if (!texto.trim()) return; await nota.mutateAsync({ id: c.id, n: { texto: texto.trim(), tipo, vence: tipo === 'tarea' && vence ? vence : null } }); setTexto(''); setVence('') }
  const pendientes = c.notasLista.filter((n) => n.tipo === 'tarea' && !n.hecha)
  return (
    <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
      <Card icon={<CalendarClock size={18} />} title="Línea de tiempo" subtitle="Compras, campañas, cambios auditados y notas en un solo lugar"
        actions={<div className="flex flex-wrap gap-1">{([['', 'Todo'], ['compra', 'Compras'], ['campana', 'Campañas'], ['cambio', 'Cambios'], ['nota', 'Notas']] as const).map(([v, l]) => (
          <button key={v} type="button" onClick={() => setFiltro(v)} className={clsx('rounded-full px-2.5 py-1 text-[11.5px] font-semibold', filtro === v ? 'bg-brand text-white' : 'bg-surface-2 text-ink-2 hover:bg-surface-hover')}>{l}</button>))}</div>}>
        {vistos.length === 0 ? <Empty text="Sin actividad" /> : (
          <ol className="relative space-y-4 border-l border-line pl-6">
            {vistos.slice(0, 60).map((e, i) => { const I = ICONO_EV[e.tipo]; return (
              <li key={i} className="relative">
                <span className={clsx('absolute -left-[37px] grid h-7 w-7 place-items-center rounded-full ring-4 ring-surface', COLOR_EV[e.tipo])}><I size={13} /></span>
                <div className="flex flex-wrap items-baseline gap-x-2"><span className="text-[13px] font-semibold text-ink">{e.titulo}</span><span className="text-[11.5px] text-ink-3">{e.ts.length > 10 ? `${fmtFecha(e.ts.slice(0, 10))} ${e.ts.slice(11, 16)}` : fmtFecha(e.ts)}{e.autor ? ` · ${e.autor}` : ''}</span></div>
                {e.detalle && <p className="mt-0.5 text-[12.5px] break-words text-ink-2">{e.detalle}</p>}
              </li>) })}
          </ol>
        )}
      </Card>
      <div className="space-y-5">
        {editar && (
          <Card icon={<ClipboardList size={18} />} title="Nueva nota o tarea">
            <div className="space-y-3">
              <div className="flex gap-1 rounded-xl bg-surface-2 p-1">{(['nota', 'tarea'] as const).map((t) => <button key={t} type="button" onClick={() => setTipo(t)} className={clsx('flex-1 rounded-lg px-3 py-1 text-[12.5px] font-semibold capitalize', tipo === t ? 'bg-surface text-brand shadow-sm' : 'text-ink-2')}>{t}</button>)}</div>
              <textarea aria-label="Texto de la nota" rows={3} value={texto} maxLength={300} onChange={(e) => setTexto(e.target.value)} placeholder={tipo === 'tarea' ? 'Ej.: Llamar para ofrecer el Club del Vino' : 'Ej.: Prefiere que lo contacten en la tarde'} className="w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-[13px] outline-none focus:border-brand" />
              {tipo === 'tarea' && <Campo etiqueta="Fecha límite"><input type="date" className={inputCls} value={vence} min={HOY_ISO} onChange={(e) => setVence(e.target.value)} /></Campo>}
              <Btn variant="primary" busy={nota.isPending} onClick={() => void agregar()} disabled={!texto.trim()}>Guardar</Btn>
            </div>
          </Card>
        )}
        <Card title="Tareas pendientes" subtitle={`${pendientes.length} por hacer`}>
          {pendientes.length === 0 ? <p className="text-[12.5px] text-ink-3">Nada pendiente.</p> : (
            <ul className="space-y-2">{pendientes.map((n) => (
              <li key={n.id} className="flex items-start gap-2 text-[12.5px]"><input type="checkbox" className="mt-1" aria-label="Marcar como hecha" disabled={!editar} onChange={() => alternar.mutate({ id: c.id, nid: n.id })} /><span className="min-w-0 flex-1 text-ink-2">{n.texto}{n.vence && <span className="block text-[11.5px] text-ink-3">Vence {fmtFecha(n.vence)}</span>}</span>
                {editar && <IconBtn title="Borrar" danger onClick={() => borrar.mutate({ id: c.id, nid: n.id })}><Trash2 size={14} /></IconBtn>}</li>))}</ul>
          )}
        </Card>
      </div>
    </div>
  )
}
