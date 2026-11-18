import clsx from 'clsx'
import { ArrowLeft, CalendarRange, Copy, FlaskConical, History, Pause, Pencil, Play, Plus, Save, Settings2, Trash2, Zap } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { FiltroMenu } from '@/components/filtros'
import { Badge, Btn, Card, ConfirmDialog, ErrorBox, Notice, Skeleton, Stat, inputCls } from '@/components/ui'
import { CANAL_LABEL, fmtCop, fmtFecha, fmtFechaHora, fmtNum } from '@/lib/format'
import { fechaISO, textoVigencia } from '@/lib/programacion'
import { useCatalogos } from '../clientes/datos'
import { SEGMENTOS } from '../clientes/modelo'
import { ICONOS, ORIGEN, TONOS, enFrase, estadoEdicion, useAccion, useAuto, useCatalogo, type Automatizacion, type Edicion, type Prueba } from './datos'
import { cuando } from './Lista'

const ESTADO_EJEC: Record<string, { label: string; tone: 'good' | 'warn' | 'bad' | 'neutral' }> = {
  ok: { label: 'Evaluada', tone: 'good' }, sin_edicion: { label: 'Sin edición vigente', tone: 'warn' },
  incompleta: { label: 'Edición incompleta', tone: 'warn' }, error: { label: 'Error', tone: 'bad' },
}
const ESTADO_ED = { vigente: { label: 'Vigente hoy', tone: 'good' }, proxima: { label: 'Próxima', tone: 'brand' }, pasada: { label: 'Terminada', tone: 'neutral' } } as const

export default function DetalleAutomatizacion() {
  const { id } = useParams()
  const nav = useNavigate()
  const { data: a, error, isLoading, refetch } = useAuto(id)
  const accion = useAccion()
  const [ocupado, setOcupado] = useState<string | null>(null)
  const [err, setErr] = useState<unknown>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [borrar, setBorrar] = useState<{ tipo: 'auto' } | { tipo: 'edicion'; e: Edicion } | null>(null)
  const hoy = fechaISO(new Date())

  const hacer = async (clave: string, fn: () => Promise<unknown>, ok?: string) => {
    setOcupado(clave); setErr(null); setMsg(null)
    try { await fn(); if (ok) setMsg(ok) } catch (e) { setErr(e) } finally { setOcupado(null) }
  }

  if (isLoading) return <div className="mx-auto max-w-[1300px] space-y-3"><Skeleton h={60} /><Skeleton h={400} /></div>
  if (error || !a) return <div className="mx-auto max-w-3xl space-y-3"><ErrorBox error={error ?? new Error('No existe')} onRetry={() => void refetch()} /><Btn onClick={() => nav('/automatizaciones')}>Volver</Btn></div>

  const Icon = ICONOS[a.tipo]
  const vig = a.ediciones.find((e) => e.id === a.vigente)

  return (
    <div className="mx-auto max-w-[1300px] space-y-5">
      <button type="button" onClick={() => nav('/automatizaciones')} className="flex items-center gap-1.5 text-[13px] font-semibold text-ink-3 hover:text-ink"><ArrowLeft size={15} />Automatizaciones</button>
      <div className="flex flex-wrap items-center gap-3">
        <span className={clsx('grid h-12 w-12 shrink-0 place-items-center rounded-xl', TONOS[a.tipo])}><Icon size={23} /></span>
        <div className="min-w-0 flex-1 basis-60">
          <h1 className="truncate text-[24px] font-semibold text-ink">{a.nombre}</h1>
          <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-ink-3">
            <Badge tone={a.activa ? 'good' : 'neutral'}>{a.activa ? 'Activa' : 'Pausada'}</Badge>
            <span>{a.tipo_nombre} · {enFrase(a.disparo)}</span>
          </div>
        </div>
        <Btn icon={<Zap size={15} />} busy={ocupado === 'ejecutar'} title="Requiere la clave de administración"
          onClick={() => void hacer('ejecutar', async () => {
            const r = await accion<Prueba>(`/automatizaciones/${a.id}/ejecutar`, { method: 'POST' })
            setMsg(r.estado === 'ok' ? `Evaluada hoy: ${fmtNum(r.enviados ?? 0)} envío(s) simulados (${fmtNum(r.elegibles ?? 0)} elegibles de ${fmtNum(r.candidatos ?? 0)} candidatos).` : r.aviso ?? '')
          })}>Ejecutar hoy</Btn>
        <Btn variant={a.activa ? 'secondary' : 'primary'} busy={ocupado === 'estado'} icon={a.activa ? <Pause size={15} /> : <Play size={15} />}
          onClick={() => void hacer('estado', () => accion(`/automatizaciones/${a.id}/${a.activa ? 'pausar' : 'activar'}`, { method: 'POST' }),
            a.activa ? 'Automatización pausada: no se evaluará hasta que la active de nuevo.' : 'Automatización activa: se evaluará sola todos los días a la hora indicada.')}>
          {a.activa ? 'Pausar' : 'Activar'}
        </Btn>
        <Btn variant="ghost" icon={<Trash2 size={15} />} onClick={() => setBorrar({ tipo: 'auto' })}>Eliminar</Btn>
      </div>

      {msg && <Notice tone="good">{msg}</Notice>}
      {err != null && <ErrorBox error={err} />}
      {a.activa && !vig && <Notice tone="warn">Hoy no hay una edición vigente: no se enviará nada hasta que una edición cubra la fecha de hoy.</Notice>}

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat label="Próxima evaluación" value={cuando(a.proxima_ejecucion)} />
        <Stat label="Envíos (últimos 30 días)" value={fmtNum(a.envios.envios)} sub={`${fmtNum(a.envios.total_historico)} en total`} />
        <Stat label="Personas distintas" value={fmtNum(a.envios.personas)} sub="últimos 30 días" />
        <Stat label="Costo estimado" value={fmtCop(a.envios.costo)} sub="últimos 30 días" />
      </div>

      <Card icon={<CalendarRange size={18} />} title="Ediciones" subtitle="Qué se ofrece en cada periodo. Cada día usa la edición que lo cubre."
        actions={<Btn small variant="primary" icon={<Plus size={14} />} onClick={() => nav(`/automatizaciones/${a.id}/edicion/nueva`)}>Nueva edición</Btn>}>
        {a.ediciones.length === 0 ? <p className="text-[13px] text-ink-3">Sin ediciones: cree una para que la automatización pueda enviar.</p> : (
          <ul className="divide-y divide-line">
            {a.ediciones.map((e) => {
              const est = estadoEdicion(e, hoy)
              return (
                <li key={e.id} className="flex flex-wrap items-start gap-3 py-3">
                  <div className="min-w-0 flex-1 basis-72">
                    <div className="flex flex-wrap items-center gap-2">
                      <b className="text-[14px] text-ink">{e.nombre}</b>
                      <Badge tone={ESTADO_ED[est].tone}>{ESTADO_ED[est].label}</Badge>
                      {e.problemas.length > 0 && <Badge tone="warn">Incompleta</Badge>}
                    </div>
                    <div className="mt-0.5 text-[12.5px] text-ink-2">{fmtFecha(e.desde)} – {fmtFecha(e.hasta)} · <b>{e.oferta.descripcion}</b> · válida {e.validez_dias === 1 ? '1 día' : `${e.validez_dias} días`} · {e.canales.map((c) => CANAL_LABEL[c] ?? c).join(', ') || 'sin canales'}</div>
                    {e.problemas.length > 0 && <div className="mt-1 text-[12px] text-warn">{e.problemas.join(' ')}</div>}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    <Btn small icon={<Pencil size={14} />} onClick={() => nav(`/automatizaciones/${a.id}/edicion/${e.id}`)}>Editar</Btn>
                    <Btn small icon={<Copy size={14} />} busy={ocupado === `dup-${e.id}`} title="Crea la misma edición un año después, para cambiarle la oferta"
                      onClick={() => void hacer(`dup-${e.id}`, () => accion(`/automatizaciones/${a.id}/ediciones/${e.id}/duplicar`, { method: 'POST' }), `Se creó la edición del año siguiente a partir de «${e.nombre}». Ábrala para cambiar la oferta.`)}>Para el año siguiente</Btn>
                    <Btn small variant="ghost" icon={<Trash2 size={14} />} onClick={() => setBorrar({ tipo: 'edicion', e })}>Eliminar</Btn>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </Card>

      <div className="grid items-start gap-5 xl:grid-cols-2">
        <Regla a={a} />
        <Probar a={a} />
      </div>

      <Card icon={<History size={18} />} title="Historial" subtitle="Cada evaluación: automática (a su hora) o manual">
        {!a.ejecuciones?.length ? <p className="text-[13px] text-ink-3">Todavía no se ha evaluado.</p> : (
          <div className="overflow-x-auto scroll-thin">
            <table className="w-full min-w-[720px] text-[12.5px]">
              <thead><tr className="text-left">{['Fecha', 'Origen', 'Resultado', 'Edición', 'Candidatos', 'Envíos', 'Costo'].map((h) => <th key={h} scope="col" className="px-2 py-2 font-semibold">{h}</th>)}</tr></thead>
              <tbody>{a.ejecuciones.map((x) => (
                <tr key={x.id} className="border-t border-line align-top">
                  <td className="px-2 py-2">{fmtFecha(x.fecha)}<div className="text-[11px] text-ink-3">{fmtFechaHora(x.inicio)}</div></td>
                  <td className="px-2 py-2">{ORIGEN(x.origen)}</td>
                  <td className="px-2 py-2"><Badge tone={ESTADO_EJEC[x.estado]?.tone ?? 'neutral'}>{ESTADO_EJEC[x.estado]?.label ?? x.estado}</Badge>{x.detalle.aviso && <div className="mt-1 max-w-[260px] text-[11px] text-ink-3">{x.detalle.aviso}</div>}</td>
                  <td className="px-2 py-2">{a.ediciones.find((e) => e.id === x.edicion_id)?.nombre ?? '—'}</td>
                  <td className="px-2 py-2 tnum">{fmtNum(x.candidatos)}</td>
                  <td className="px-2 py-2 font-semibold tnum">{fmtNum(x.enviados)}</td>
                  <td className="px-2 py-2 tnum">{fmtCop(x.costo)}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </Card>

      <ConfirmDialog open={!!borrar} danger busy={ocupado === 'borrar'} confirmLabel="Eliminar"
        title={borrar?.tipo === 'auto' ? 'Eliminar automatización' : 'Eliminar edición'} onCancel={() => setBorrar(null)}
        onConfirm={() => void hacer('borrar', async () => {
          if (borrar?.tipo === 'auto') { await accion(`/automatizaciones/${a.id}`, { method: 'DELETE' }); nav('/automatizaciones') }
          else if (borrar?.tipo === 'edicion') await accion(`/automatizaciones/${a.id}/ediciones/${borrar.e.id}`, { method: 'DELETE' })
          setBorrar(null)
        })}>
        {borrar?.tipo === 'auto' ? <>Se eliminará <b>{a.nombre}</b> y dejará de evaluarse. Los envíos ya registrados se conservan en el historial de contactos.</>
          : <>Se eliminará la edición <b>{borrar?.tipo === 'edicion' ? borrar.e.nombre : ''}</b>. Si era la única completa, la automatización se pausa.</>}
      </ConfirmDialog>
    </div>
  )
}

/** Reglas del disparo: parámetros del tipo, hora, filtros y nombre. */
function Regla({ a }: { a: Automatizacion }) {
  const { data: cat } = useCatalogo()
  const catCli = useCatalogos().data
  const accion = useAccion()
  const def = cat?.tipos.find((t) => t.id === a.tipo)
  const inicial = useMemo(() => ({ nombre: a.nombre, hora: a.hora, params: a.params, filtros: a.filtros }), [a])
  const [f, setF] = useState(inicial)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<unknown>(null)
  const [ok, setOk] = useState(false)
  useEffect(() => { setF(inicial) }, [inicial])
  const sucio = JSON.stringify(f) !== JSON.stringify(inicial)
  const guardar = async () => {
    setBusy(true); setErr(null); setOk(false)
    try { await accion(`/automatizaciones/${a.id}`, { method: 'PUT', body: f }); setOk(true) } catch (e) { setErr(e) } finally { setBusy(false) }
  }
  const clubes = (catCli?.afiliaciones ?? []).map((x) => ({ id: x.id, label: x.nombre, color: x.color }))
  return (
    <Card icon={<Settings2 size={18} />} title="Regla" subtitle="Cuándo se dispara y a quién"
      actions={<Btn small variant="primary" icon={<Save size={14} />} busy={busy} disabled={!sucio} onClick={() => void guardar()}>{sucio ? 'Guardar' : 'Guardado'}</Btn>}>
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
          <label className="text-[12px] font-semibold text-ink-2">Nombre
            <input className={clsx(inputCls, 'mt-1 font-normal')} value={f.nombre} maxLength={80} onChange={(e) => setF({ ...f, nombre: e.target.value })} /></label>
          <label className="text-[12px] font-semibold text-ink-2">Hora de envío
            <input type="time" className={clsx(inputCls, 'mt-1 block font-normal')} style={{ width: 150 }} value={f.hora} onChange={(e) => setF({ ...f, hora: e.target.value })} /></label>
        </div>
        {def?.params.map((p) => (
          <label key={p.clave} className="block text-[12px] font-semibold text-ink-2">{p.label}
            <span className="mt-1 flex items-center gap-2">
              <input type="number" min={p.min} max={p.max} step={p.paso} value={f.params[p.clave] ?? p.defecto}
                onChange={(e) => setF({ ...f, params: { ...f.params, [p.clave]: Number(e.target.value) } })}
                className={clsx(inputCls, 'font-normal tnum')} style={{ width: 120 }} />
              <span className="text-[12.5px] font-normal text-ink-2">{p.unidad}</span>
            </span>
            <span className="mt-1 block text-[11.5px] font-normal text-ink-3">{p.ayuda} (de {fmtNum(p.min)} a {fmtNum(p.max)})</span>
          </label>
        ))}
        <div>
          <div className="mb-1.5 text-[12px] font-semibold text-ink-2">Solo para <span className="font-normal text-ink-3">(opcional: sin elegir, aplica a todos los clientes)</span></div>
          <div className="flex flex-wrap gap-2">
            <FiltroMenu label="Clubes" opciones={clubes} valor={f.filtros.clubes} onChange={(v) => setF({ ...f, filtros: { ...f.filtros, clubes: v } })} />
            <FiltroMenu label="Segmentos" opciones={Object.entries(SEGMENTOS).map(([id, label]) => ({ id, label }))} valor={f.filtros.segmentos}
              onChange={(v) => setF({ ...f, filtros: { ...f.filtros, segmentos: v } })} />
          </div>
        </div>
        <p className="text-[11.5px] text-ink-3">Siempre se aplican las reglas legales: solo clientes que autorizan sus datos, sin BLOQUE, por los canales que autorizaron y nunca menores de edad si la oferta incluye licor o cigarrillo.</p>
        {ok && !sucio && <Notice tone="good">Regla guardada.</Notice>}
        {err != null && <ErrorBox error={err} />}
      </div>
    </Card>
  )
}

/** «¿A quién le tocaría ese día?»: calcula sin registrar nada. */
function Probar({ a }: { a: Automatizacion }) {
  const { data: cat } = useCatalogo()
  const accion = useAccion()
  const [fecha, setFecha] = useState(fechaISO(new Date()))
  const [ed, setEd] = useState('')
  const [r, setR] = useState<Prueba | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<unknown>(null)
  const calcular = async () => {
    setBusy(true); setErr(null)
    try { setR(await accion<Prueba>(`/automatizaciones/${a.id}/probar`, { method: 'POST', body: { fecha, edicion_id: ed || null } })) } catch (e) { setErr(e); setR(null) } finally { setBusy(false) }
  }
  const excl = Object.entries(r?.excluidos ?? {}).sort((x, y) => y[1] - x[1])
  return (
    <Card icon={<FlaskConical size={18} />} title="Probar" subtitle="¿A quién le tocaría un día? Solo calcula: no envía ni registra nada">
      <div className="space-y-4">
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-[12px] font-semibold text-ink-2">Día
            <input type="date" className={clsx(inputCls, 'mt-1 font-normal')} value={fecha} onChange={(e) => setFecha(e.target.value)} /></label>
          <label className="min-w-48 flex-1 text-[12px] font-semibold text-ink-2">Edición
            <select className={clsx(inputCls, 'mt-1 font-normal')} value={ed} onChange={(e) => setEd(e.target.value)}>
              <option value="">La vigente ese día</option>
              {a.ediciones.map((e) => <option key={e.id} value={e.id}>{e.nombre}</option>)}
            </select></label>
          <Btn variant="primary" busy={busy} disabled={!fecha} onClick={() => void calcular()}>Calcular</Btn>
        </div>
        {err != null && <ErrorBox error={err} />}
        {r && (r.estado !== 'ok' ? <Notice tone="warn">{r.aviso}</Notice> : (
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-3">
              <Stat label="Cumplen la condición" value={fmtNum(r.candidatos ?? 0)} />
              <Stat label="Recibirían el mensaje" value={fmtNum(r.elegibles ?? 0)} tone="good" />
              <Stat label="Costo estimado" value={fmtCop(r.costo ?? 0)} />
            </div>
            <p className="text-[12.5px] text-ink-2">Edición <b>{r.edicion?.nombre}</b>: {r.edicion?.oferta}, válida {r.vigencia_desde && r.vigencia_hasta ? textoVigencia(r.vigencia_desde, r.vigencia_hasta) : ''}.
              {' '}Por canal: {Object.entries(r.por_canal ?? {}).filter(([, n]) => n > 0).map(([c, n]) => `${CANAL_LABEL[c] ?? c} ${fmtNum(n)}`).join(' · ') || 'ninguno'}.</p>
            {excl.length > 0 && (
              <div>
                <div className="mb-1 text-[12px] font-semibold text-ink-2">Quedan fuera</div>
                <ul className="space-y-1">
                  {excl.map(([k, n]) => <li key={k} className="flex justify-between gap-3 text-[12.5px]"><span className="text-ink-2">{cat?.motivos[k] ?? k}</span><b className="text-ink tnum">{fmtNum(n)}</b></li>)}
                </ul>
              </div>
            )}
            {(r.muestra?.length ?? 0) > 0 && (
              <div>
                <div className="mb-1 text-[12px] font-semibold text-ink-2">Algunos que lo recibirían <span className="font-normal text-ink-3">(nombres ocultos)</span></div>
                <div className="flex flex-wrap gap-1.5">{r.muestra!.map((m, i) => <span key={i} className="rounded-full bg-surface-2 px-2.5 py-1 text-[12px] text-ink-2">{m.cliente} · {m.canales.map((c) => CANAL_LABEL[c] ?? c).join(', ')}</span>)}</div>
              </div>
            )}
          </div>
        ))}
      </div>
    </Card>
  )
}
