import { useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { ArrowLeft, ArrowRight, CalendarClock, Check, CheckCircle2, Rocket, Save } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Btn, ConfirmDialog, ErrorBox, Notice, Skeleton } from '@/components/ui'
import { api, useGet, type Campana, type Mensaje, type Preview, type Producto } from '@/lib/api'
import { fmtCop, fmtNum } from '@/lib/format'
import { aLocalISO, errorFecha, fmtProgramada } from '@/lib/programacion'
import PasoMensaje from './PasoMensaje'
import PasoProductos from './PasoProductos'
import PanelPublicacion, { fmtPrograma, PROGRAMA_INICIAL, type Programa } from './PanelPublicacion'
import PasoSegmentacion, { type FiltrosSeg } from './PasoSegmentacion'
import ResumenCampana, { pendientes } from './ResumenCampana'

const PASOS = [
  { n: 1, t: 'Productos', d: 'Qué se promociona' },
  { n: 2, t: 'Mensaje', d: 'Redacción por canal' },
  { n: 3, t: 'Audiencia', d: 'A quién se envía' },
  { n: 4, t: 'Revisar y publicar', d: 'Resumen final' },
]

const MENSAJE_VACIO: Mensaje = { modo: 'ia', prompt: '', tono: '', canales: ['whatsapp', 'sms', 'email'], textos: {}, tokens: 0, temporada_id: null }
const FILTROS_VACIO: FiltrosSeg = { consentimiento: 'estricto', objetivo: 'equilibrado' }

export default function Wizard() {
  const { id: idParam } = useParams()
  const nav = useNavigate()
  const qc = useQueryClient()
  const [id, setId] = useState<string | undefined>(idParam)
  const { data: existente, error: errCarga, isLoading } = useGet<Campana>(`/campanas/${idParam}`, { enabled: !!idParam, stale: 0 })

  const [paso, setPaso] = useState(1)
  const [nombre, setNombre] = useState('')
  const [objetivo, setObjetivo] = useState('')
  const [productos, setProductos] = useState<Producto[]>([])
  const [mensaje, setMensaje] = useState<Mensaje>(MENSAJE_VACIO)
  const [filtros, setFiltros] = useState<FiltrosSeg>(FILTROS_VACIO)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [sucio, setSucio] = useState(false)
  const [guardando, setGuardando] = useState(false)
  const [errGuardar, setErrGuardar] = useState<unknown>(null)
  const [confirmar, setConfirmar] = useState(false)
  const [publicando, setPublicando] = useState(false)
  const [errPub, setErrPub] = useState<string | null>(null)
  const [programa, setPrograma] = useState<Programa>(PROGRAMA_INICIAL)
  const [hecho, setHecho] = useState<{ destinatarios: number; costo: number; por_canal: Record<string, number>; programada: boolean; cuando: string | null; control: number; avisos: string[] } | null>(null)
  const cargado = useRef(false)

  // Carga inicial de un borrador existente.
  useEffect(() => {
    if (!existente || cargado.current) return
    cargado.current = true
    setNombre(existente.nombre); setObjetivo(existente.objetivo); setProductos(existente.productos)
    setMensaje({ ...MENSAJE_VACIO, ...existente.mensaje, textos: existente.mensaje.textos ?? {}, canales: existente.mensaje.canales ?? MENSAJE_VACIO.canales } as Mensaje)
    setFiltros({ ...FILTROS_VACIO, ...(existente.segmentacion?.filtros ?? {}) })
    setPaso(Math.min(4, Math.max(1, existente.paso)))
  }, [existente])

  useEffect(() => {
    if (!sucio) return
    const h = (e: BeforeUnloadEvent) => { e.preventDefault() }
    window.addEventListener('beforeunload', h)
    return () => window.removeEventListener('beforeunload', h)
  }, [sucio])

  const marcar = <T,>(fn: (v: T) => void) => (v: T) => { fn(v); setSucio(true) }

  const payload = useCallback((p: number) => ({
    nombre: nombre.trim() || 'Campaña sin título', objetivo: objetivo.trim(), paso: p,
    productos: productos.map(({ producto_id, producto, marca, precio_venta, familia, grupo, razon, stock_actual }) => ({ producto_id, producto, marca, precio_venta, familia, grupo, razon, stock_actual })),
    mensaje, segmentacion: { filtros },
    audiencia: preview?.resumen.audiencia ?? existente?.audiencia ?? 0, costo_estimado: preview?.resumen.costo_estimado ?? existente?.costo_estimado ?? 0,
  }), [nombre, objetivo, productos, mensaje, filtros, preview, existente])

  const guardar = useCallback(async (p: number): Promise<string | null> => {
    setGuardando(true); setErrGuardar(null)
    try {
      const c = id ? await api<Campana>(`/campanas/${id}`, { method: 'PUT', body: payload(p) }) : await api<Campana>('/campanas', { method: 'POST', body: payload(p) })
      if (!id) { setId(c.id); window.history.replaceState(null, '', `/campanas/${c.id}/editar`) }
      setSucio(false)
      void qc.invalidateQueries({ predicate: (x) => String(x.queryKey[0]).startsWith('/campanas') })
      return c.id
    } catch (e) { setErrGuardar(e); return null } finally { setGuardando(false) }
  }, [id, payload, qc])

  const faltantes = useMemo(() => {
    const p = pendientes({ nombre, objetivo, productos, mensaje, filtros, audiencia: 0, costo: 0, preview })
    const e = programa.modo === 'programar' ? errorFecha(programa.fecha, programa.hora) : null
    return e ? [...p, e] : p
  }, [nombre, objetivo, productos, mensaje, filtros, preview, programa])
  const programar = programa.modo === 'programar'
  const puedeIr = (n: number) => (n <= 1 ? true : n === 2 ? productos.length > 0 : n === 3 ? productos.length > 0 && mensaje.canales.length > 0 : productos.length > 0 && mensaje.canales.length > 0)
  const irA = async (n: number) => {
    if (!puedeIr(n)) return
    if (sucio || !id) { if ((await guardar(n)) === null) return }
    setPaso(n)
    window.scrollTo({ top: 0 })
    document.getElementById('contenido')?.scrollTo({ top: 0 })
  }

  const publicar = async () => {
    setPublicando(true); setErrPub(null)
    try {
      const cid = await guardar(4)
      if (!cid) { setPublicando(false); return }
      const r = await api<{ destinatarios: number; costo_estimado: number; por_canal: Record<string, number>; programada: boolean; programada_para: string | null; control: number; avisos: string[] }>(`/campanas/${cid}/publicar`, {
        method: 'POST', body: { programar_para: programa.modo === 'programar' ? aLocalISO(programa.fecha, programa.hora) : null, control_pct: programa.control },
      })
      setHecho({ destinatarios: r.destinatarios, costo: r.costo_estimado, por_canal: r.por_canal, programada: r.programada, cuando: r.programada_para, control: r.control, avisos: r.avisos ?? [] })
      setConfirmar(false)
      void qc.invalidateQueries({ predicate: (x) => String(x.queryKey[0]).startsWith('/campanas') })
    } catch (e) { setErrPub(e instanceof Error ? e.message : 'No se pudo publicar') } finally { setPublicando(false) }
  }

  if (idParam && isLoading) return <div className="mx-auto max-w-6xl space-y-3"><Skeleton h={60} /><Skeleton h={400} /></div>
  if (idParam && errCarga) return <div className="mx-auto max-w-3xl"><ErrorBox error={errCarga} /></div>
  // Ojo: tras publicar, la consulta se refresca y la campaña ya no es borrador; la pantalla de «hecho» debe mostrarse primero.
  if (!hecho && existente && existente.estado !== 'borrador') {
    return <div className="mx-auto max-w-3xl space-y-3"><Notice tone="info">{existente.estado === 'programada' ? 'Esta campaña está programada: cancele la programación (en «Ver campaña») para volver a editarla.' : 'Esta campaña ya fue publicada y no se puede editar.'}</Notice><Btn variant="primary" onClick={() => nav(`/campanas/${existente.id}`)}>Ver campaña</Btn></div>
  }

  if (hecho) {
    return (
      <div className="mx-auto max-w-2xl py-8">
        <div className="card p-8 text-center">
          <CheckCircle2 size={44} className="mx-auto text-good" />
          <h1 className="mt-3 text-[20px] font-bold text-ink">{hecho.programada ? 'Campaña programada' : 'Campaña publicada (simulación)'}</h1>
          <p className="mx-auto mt-2 max-w-md text-[13px] leading-relaxed text-ink-2">
            {hecho.programada ? <>Se publicará el <b>{fmtProgramada(hecho.cuando)}</b> para </> : <>Se registró la campaña con </>}<b>{fmtNum(hecho.destinatarios)}</b> destinatarios y un costo estimado de <b>{fmtCop(hecho.costo)}</b>.
            {hecho.control > 0 && <> Además <b>{fmtNum(hecho.control)}</b> personas quedaron como grupo de control (sin envío) para medir el efecto real.</>}{' '}
            Por ahora <b>no se envía ningún mensaje real</b>: la difusión por WhatsApp, SMS y correo se conectará en una siguiente fase.</p>
          {hecho.programada && <p className="mx-auto mt-2 max-w-md text-[12px] text-ink-3">Mientras esté programada puede cancelarla desde el historial para volver a editarla.</p>}
          {hecho.avisos.map((a) => <div key={a} className="mx-auto mt-3 max-w-md text-left"><Notice tone="warn">{a}</Notice></div>)}
          <div className="mt-6 flex justify-center gap-2"><Btn onClick={() => nav('/campanas')}>Ir al historial</Btn><Btn variant="primary" onClick={() => nav(`/campanas/${id}`)}>Ver campaña</Btn></div>
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-[1400px] space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-64 flex-1">
          <label className="text-[12px] font-semibold text-ink-3" htmlFor="nombre">Nombre de la campaña</label>
          <input id="nombre" value={nombre} maxLength={120} onChange={(e) => marcar(setNombre)(e.target.value)} placeholder="Ej.: Feria de Manizales — licores y refrescos"
            className="mt-0.5 h-10 w-full rounded-lg border border-line-strong bg-surface px-3 text-[15px] font-bold text-ink outline-none placeholder:font-normal placeholder:text-ink-3 focus:border-brand" />
        </div>
        <div className="min-w-64 flex-1">
          <label className="text-[12px] font-semibold text-ink-3" htmlFor="objetivo">Objetivo (opcional)</label>
          <input id="objetivo" value={objetivo} maxLength={600} onChange={(e) => marcar(setObjetivo)(e.target.value)} placeholder="Ej.: Rotar el inventario de licores antes de diciembre"
            className="mt-0.5 h-10 w-full rounded-lg border border-line-strong bg-surface px-3 text-[13px] text-ink outline-none placeholder:text-ink-3 focus:border-brand" />
        </div>
        <Btn icon={<Save size={15} />} busy={guardando} onClick={() => void guardar(paso)} disabled={!sucio && !!id}>{sucio || !id ? 'Guardar borrador' : 'Guardado'}</Btn>
      </div>

      <nav aria-label="Pasos de la campaña">
        <ol className="grid grid-cols-2 gap-2 md:grid-cols-4">
          {PASOS.map((p) => {
            const hecho = p.n < paso, activo = p.n === paso, ok = puedeIr(p.n)
            return (
              <li key={p.n}>
                <button type="button" disabled={!ok} aria-current={activo ? 'step' : undefined} onClick={() => void irA(p.n)}
                  className={clsx('flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition disabled:cursor-not-allowed disabled:opacity-50',
                    activo ? 'border-brand bg-brand-soft' : 'border-line bg-surface hover:bg-surface-hover')}>
                  <span className={clsx('grid h-7 w-7 shrink-0 place-items-center rounded-full text-[12px] font-bold', activo ? 'bg-brand text-white' : hecho ? 'bg-good text-white' : 'bg-surface-2 text-ink-3')}>{hecho ? <Check size={14} strokeWidth={3} /> : p.n}</span>
                  <span className="min-w-0"><span className={clsx('block truncate text-[13px] font-bold', activo ? 'text-brand' : 'text-ink')}>{p.t}</span><span className="hidden truncate text-[11.5px] text-ink-3 sm:block">{p.d}</span></span>
                </button>
              </li>
            )
          })}
        </ol>
      </nav>

      {errGuardar != null && <ErrorBox error={errGuardar} />}

      {paso === 1 && <PasoProductos value={productos} onChange={marcar(setProductos)} temporadaId={mensaje.temporada_id ?? null} onTemporada={(t) => marcar(setMensaje)({ ...mensaje, temporada_id: t })} />}
      {paso === 2 && <PasoMensaje mensaje={mensaje} onChange={marcar(setMensaje)} productos={productos} temporadaId={mensaje.temporada_id ?? null} />}
      {paso === 3 && <PasoSegmentacion filtros={filtros} onChange={marcar(setFiltros)} productos={productos} canales={mensaje.canales} temporadaId={mensaje.temporada_id ?? null} onPreview={setPreview} />}
      {paso === 4 && (
        <div className="space-y-4">
          <ResumenCampana d={{ nombre, objetivo, productos, mensaje, filtros, audiencia: preview?.resumen.audiencia ?? 0, costo: preview?.resumen.costo_estimado ?? 0, preview }} />
          <PanelPublicacion valor={programa} onChange={setPrograma} canales={mensaje.canales} momento={preview?.resumen.momento} audiencia={preview?.resumen.audiencia ?? 0} />
          {!preview && <Notice tone="info">Para ver el costo y los destinatarios exactos, pase por el paso <b>Audiencia</b>.</Notice>}
          {faltantes.length > 0 && <Notice tone="warn"><b>Antes de publicar:</b><ul className="mt-1 list-disc pl-5">{faltantes.map((f) => <li key={f}>{f}</li>)}</ul></Notice>}
        </div>
      )}

      <div className="flex items-center gap-3 pt-1 pb-6">
        <Btn variant="ghost" icon={<ArrowLeft size={15} />} onClick={() => (paso === 1 ? nav('/campanas') : void irA(paso - 1))}>{paso === 1 ? 'Volver al historial' : 'Atrás'}</Btn>
        <span className="ml-auto hidden text-[12px] text-ink-3 sm:block">
          {productos.length} producto(s){preview ? ` · ${fmtNum(preview.resumen.audiencia)} destinatarios · ${fmtCop(preview.resumen.costo_estimado)}` : ''}
        </span>
        {paso < 4
          ? <Btn variant="primary" disabled={!puedeIr(paso + 1)} busy={guardando} onClick={() => void irA(paso + 1)}>Siguiente <ArrowRight size={15} /></Btn>
          : <Btn variant="accent" icon={programar ? <CalendarClock size={15} /> : <Rocket size={15} />} disabled={faltantes.length > 0} onClick={() => setConfirmar(true)}>{programar ? 'Programar campaña' : 'Publicar campaña'}</Btn>}
      </div>

      <ConfirmDialog open={confirmar} title={programar ? 'Programar campaña' : 'Publicar campaña'} confirmLabel={programar ? 'Programar' : 'Publicar'} busy={publicando} onCancel={() => setConfirmar(false)} onConfirm={() => void publicar()}>
        {programar ? <>Se programará la campaña <b>{nombre || 'sin título'}</b> para el <b>{fmtPrograma(programa)}</b>, dirigida a <b>{fmtNum(preview?.resumen.audiencia ?? 0)}</b> personas (≈ {fmtCop(preview?.resumen.costo_estimado ?? 0)}).</>
          : <>Se registrará la campaña <b>{nombre || 'sin título'}</b> para <b>{fmtNum(preview?.resumen.audiencia ?? 0)}</b> personas (≈ {fmtCop(preview?.resumen.costo_estimado ?? 0)}).</>}
        <div className="mt-2 rounded-lg bg-info-soft px-3 py-2 text-[12.5px] text-info">Es una <b>simulación</b>: no se enviará ningún mensaje real. {programar ? 'Mientras esté programada podrá cancelarla para volver a editarla; el público se recalcula al confirmar.' : 'Después de publicar la campaña ya no se podrá editar.'}</div>
        {errPub && <div className="mt-2 text-bad">{errPub}</div>}
      </ConfirmDialog>
    </div>
  )
}
