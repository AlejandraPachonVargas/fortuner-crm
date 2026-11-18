import clsx from 'clsx'
import { CalendarClock, Pause, Play, Plus, Workflow } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Badge, Btn, ErrorBox, Notice, Skeleton, Stat } from '@/components/ui'
import { fmtCop, fmtFecha, fmtFechaHora, fmtNum } from '@/lib/format'
import { ICONOS, TONOS, enFrase, useAccion, useAutos, useCatalogo, type Automatizacion, type TipoId } from './datos'

/** Tarjetas para elegir el tipo de automatización (pantalla «Nueva» y lista vacía). */
export function ElegirTipo() {
  const { data: cat } = useCatalogo()
  const accion = useAccion()
  const nav = useNavigate()
  const [creando, setCreando] = useState<TipoId | null>(null)
  const [err, setErr] = useState<unknown>(null)
  const crear = async (tipo: TipoId) => {
    setCreando(tipo); setErr(null)
    try {
      const a = await accion<Automatizacion>('/automatizaciones', { method: 'POST', body: { tipo } })
      nav(`/automatizaciones/${a.id}`)
    } catch (e) { setErr(e) } finally { setCreando(null) }
  }
  if (!cat) return <div className="grid gap-3 md:grid-cols-2"><Skeleton h={120} /><Skeleton h={120} /></div>
  return (
    <div className="space-y-3">
      {err != null && <ErrorBox error={err} />}
      <div className="grid gap-3 md:grid-cols-2">
        {cat.tipos.map((t) => {
          const Icon = ICONOS[t.id]
          return (
            <button key={t.id} type="button" disabled={!!creando} onClick={() => void crear(t.id)}
              className="card flex items-start gap-4 p-4 text-left transition hover:border-brand hover:shadow-md disabled:opacity-60">
              <span className={clsx('grid h-11 w-11 shrink-0 place-items-center rounded-xl', TONOS[t.id])}><Icon size={21} /></span>
              <span className="min-w-0">
                <span className="block text-[15px] font-semibold text-ink">{t.nombre}{creando === t.id && ' · creando…'}</span>
                <span className="mt-0.5 block text-[12.5px] text-ink-2">{t.descripcion}</span>
                <span className="mt-1.5 block text-[11.5px] text-ink-3">Se dispara: {enFrase(t.disparo)}</span>
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

export function NuevaAutomatizacion() {
  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div>
        <h1 className="text-[24px] font-semibold text-ink">Nueva automatización</h1>
        <p className="text-[13px] text-ink-3">Elija qué la dispara. Se crea pausada, con una oferta y mensajes de ejemplo que puede cambiar antes de activarla.</p>
      </div>
      <ElegirTipo />
    </div>
  )
}

/** Fecha y hora de la próxima evaluación en palabras («hoy 9:00 a. m.», «mañana 9:00 a. m.»). */
export function cuando(iso: string | null): string {
  if (!iso) return 'Pausada'
  const d = new Date(iso), hoy = new Date()
  const man = new Date(); man.setDate(hoy.getDate() + 1)
  const hora = d.toLocaleTimeString('es-CO', { hour: 'numeric', minute: '2-digit' })
  if (d.toDateString() === hoy.toDateString()) return `Hoy ${hora}`
  if (d.toDateString() === man.toDateString()) return `Mañana ${hora}`
  return fmtFechaHora(iso)
}

export default function ListaAutomatizaciones() {
  const nav = useNavigate()
  const { data, error, isLoading, refetch } = useAutos()
  const accion = useAccion()
  const [ocupado, setOcupado] = useState<string | null>(null)
  const [err, setErr] = useState<unknown>(null)
  const items = data?.items ?? []
  const r = data?.resumen
  const activas = items.filter((a) => a.activa).length

  const alternar = async (a: Automatizacion) => {
    setOcupado(a.id); setErr(null)
    try { await accion(`/automatizaciones/${a.id}/${a.activa ? 'pausar' : 'activar'}`, { method: 'POST' }) } catch (e) { setErr(e) } finally { setOcupado(null) }
  }

  return (
    <div className="mx-auto max-w-[1300px] space-y-5">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1 basis-72">
          <h1 className="flex items-center gap-2 text-[24px] font-semibold text-ink"><Workflow size={22} className="text-brand" />Automatizaciones</h1>
          <p className="text-[13px] text-ink-3">Campañas que se envían solas cuando un cliente cumple una condición, con la oferta que usted defina para cada periodo.</p>
        </div>
        <Btn variant="accent" icon={<Plus size={16} />} onClick={() => nav('/automatizaciones/nueva')}>Nueva automatización</Btn>
      </div>
      <Notice tone="info">Los envíos son <b>simulados</b>: se calculan con los datos reales del ERP y se registran, pero no se manda ningún mensaje hasta conectar la difusión real.</Notice>

      {error ? <ErrorBox error={error} onRetry={() => void refetch()} /> : isLoading ? <Skeleton h={300} /> : <>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <Stat label="Activas" value={`${fmtNum(activas)} de ${fmtNum(items.length)}`} />
          <Stat label="Envíos (últimos 30 días)" value={fmtNum(r?.envios ?? 0)} sub="simulados" />
          <Stat label="Personas distintas" value={fmtNum(r?.personas ?? 0)} sub="últimos 30 días" />
          <Stat label="Costo estimado" value={fmtCop(r?.costo ?? 0)} sub="últimos 30 días" />
        </div>
        {err != null && <ErrorBox error={err} />}
        {items.length === 0 ? (
          <div className="space-y-3">
            <h2 className="text-[16px] font-semibold text-ink">Cree la primera</h2>
            <ElegirTipo />
          </div>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {items.map((a) => {
              const Icon = ICONOS[a.tipo]
              const vig = a.ediciones.find((e) => e.id === a.vigente)
              return (
                <article key={a.id} className="card flex flex-col p-4">
                  <div className="flex items-start gap-3">
                    <span className={clsx('grid h-11 w-11 shrink-0 place-items-center rounded-xl', TONOS[a.tipo])}><Icon size={21} /></span>
                    <div className="min-w-0 flex-1">
                      <button type="button" onClick={() => nav(`/automatizaciones/${a.id}`)} className="block truncate text-left text-[15.5px] font-semibold text-ink hover:text-brand">{a.nombre}</button>
                      <div className="text-[12px] text-ink-3">{a.tipo_nombre} · {enFrase(a.disparo)}</div>
                    </div>
                    <Badge tone={a.activa ? 'good' : 'neutral'}>{a.activa ? 'Activa' : 'Pausada'}</Badge>
                  </div>
                  <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-[12.5px]">
                    <div className="col-span-2">
                      <dt className="text-ink-3">Oferta vigente</dt>
                      <dd className="font-medium text-ink">{vig ? <>{vig.oferta.descripcion} <span className="font-normal text-ink-3">· {vig.nombre}</span></> : <span className="text-warn">Sin edición vigente hoy: no se envía nada</span>}</dd>
                    </div>
                    <div><dt className="text-ink-3">Próxima evaluación</dt><dd className="flex items-center gap-1 font-medium text-ink"><CalendarClock size={13} className="text-ink-3" />{cuando(a.proxima_ejecucion)}</dd></div>
                    <div><dt className="text-ink-3">Envíos (30 días)</dt><dd className="font-medium text-ink tnum">{fmtNum(a.envios.envios)} · {fmtCop(a.envios.costo)}</dd></div>
                    <div className="col-span-2"><dt className="text-ink-3">Última evaluación</dt>
                      <dd className="text-ink">{a.ultima ? <>{fmtFecha(a.ultima.fecha)} · {a.ultima.estado === 'ok' ? `${fmtNum(a.ultima.enviados)} envío(s)` : a.ultima.detalle.aviso ?? a.ultima.estado}</> : 'Todavía no se ha evaluado'}</dd></div>
                  </dl>
                  <div className="mt-4 flex flex-wrap gap-2 border-t border-line pt-3">
                    <Btn small onClick={() => nav(`/automatizaciones/${a.id}`)}>Abrir</Btn>
                    <Btn small variant={a.activa ? 'secondary' : 'primary'} busy={ocupado === a.id} icon={a.activa ? <Pause size={14} /> : <Play size={14} />} onClick={() => void alternar(a)}>
                      {a.activa ? 'Pausar' : 'Activar'}
                    </Btn>
                  </div>
                </article>
              )
            })}
          </div>
        )}
      </>}
    </div>
  )
}
