import clsx from 'clsx'
import { CalendarClock, FlaskConical, Rocket, Sparkles } from 'lucide-react'
import { useMemo } from 'react'
import { Card, Notice } from '@/components/ui'
import type { Momento } from '@/lib/api'
import { DIAS, fmtNum } from '@/lib/format'
import { aDate, avisosHorario, errorFecha, fechaISO, fmtProgramada, sugerirMomento } from '@/lib/programacion'

export interface Programa { modo: 'ahora' | 'programar'; fecha: string; hora: string; control: number }
export const PROGRAMA_INICIAL: Programa = { modo: 'ahora', fecha: '', hora: '09:00', control: 0 }

interface Props { valor: Programa; onChange: (p: Programa) => void; canales: string[]; momento?: Momento; audiencia: number }

/** Paso final: publicar ahora o programar día y hora (con sugerencia basada en cuándo compra la audiencia) + grupo de control. */
export default function PanelPublicacion({ valor, onChange, canales, momento, audiencia }: Props) {
  const set = (p: Partial<Programa>) => onChange({ ...valor, ...p })
  const hoy = fechaISO(new Date())
  const sug = useMemo(() => sugerirMomento(momento), [momento])
  const manana = useMemo(() => { const d = new Date(); d.setDate(d.getDate() + 1); return fechaISO(d) }, [])
  const err = valor.modo === 'programar' ? errorFecha(valor.fecha, valor.hora) : null
  const avisos = valor.modo === 'programar' && !err ? avisosHorario(aDate(valor.fecha, valor.hora), canales) : []
  const maxDia = Math.max(1, ...(momento?.dias.map((d) => d.n) ?? [1]))
  const diaSel = valor.fecha && !err ? (aDate(valor.fecha, valor.hora).getDay() || 7) : null
  const nControl = Math.round((audiencia * valor.control) / 100)

  return (
    <Card title="Cuándo publicar" subtitle="Ahora, o programe el día y la hora exactos" actions={<CalendarClock size={16} className="text-ink-3" />}>
      <div className="space-y-4">
        <div role="radiogroup" aria-label="Momento de publicación" className="grid gap-2 sm:grid-cols-2">
          {([['ahora', Rocket, 'Publicar ahora', 'Queda registrada de inmediato.'], ['programar', CalendarClock, 'Programar', 'Se publica sola el día y la hora que elija.']] as const).map(([id, Icon, t, d]) => (
            <button key={id} type="button" role="radio" aria-checked={valor.modo === id} onClick={() => set({ modo: id, fecha: id === 'programar' && !valor.fecha ? (sug?.fecha ?? manana) : valor.fecha, hora: id === 'programar' && !valor.fecha && sug ? sug.hora : valor.hora })}
              className={clsx('flex items-start gap-3 rounded-xl border p-3 text-left transition', valor.modo === id ? 'border-brand bg-brand-soft' : 'border-line-strong hover:bg-surface-hover')}>
              <Icon size={18} className={valor.modo === id ? 'text-brand' : 'text-ink-3'} />
              <span><span className="block text-[13px] font-bold text-ink">{t}</span><span className="block text-[11.5px] text-ink-3">{d}</span></span>
            </button>
          ))}
        </div>

        {valor.modo === 'programar' && (
          <div className="space-y-3 rounded-xl bg-surface-2 p-3.5">
            <div className="flex flex-wrap items-end gap-3">
              <label className="text-[12px] font-semibold text-ink-2">Fecha
                <input type="date" value={valor.fecha} min={hoy} onChange={(e) => set({ fecha: e.target.value })} className="mt-1 block h-9 rounded-lg border border-line-strong bg-surface px-2.5 text-[13px] font-normal text-ink" /></label>
              <label className="text-[12px] font-semibold text-ink-2">Hora
                <input type="time" value={valor.hora} onChange={(e) => set({ hora: e.target.value })} className="mt-1 block h-9 rounded-lg border border-line-strong bg-surface px-2.5 text-[13px] font-normal text-ink" /></label>
              <div className="flex flex-wrap gap-1.5">
                {sug && <button type="button" onClick={() => set({ fecha: sug.fecha, hora: sug.hora })} className="flex h-9 items-center gap-1.5 rounded-lg border border-brand bg-brand-soft px-2.5 text-[12.5px] font-semibold text-brand hover:opacity-90"><Sparkles size={14} />Mejor momento: {sug.etiqueta}</button>}
                <button type="button" onClick={() => set({ fecha: manana, hora: '09:00' })} className="h-9 rounded-lg border border-line-strong px-2.5 text-[12.5px] font-medium text-ink-2 hover:bg-surface-hover">Mañana 9:00 a. m.</button>
              </div>
            </div>
            {err ? <Notice tone="bad">{err}</Notice> : <p className="text-[13px] text-ink">Se publicará el <b>{fmtProgramada(`${valor.fecha}T${valor.hora}:00`)}</b> <span className="text-ink-3">(hora del servidor)</span>.</p>}
            {avisos.map((a) => <Notice key={a} tone="warn">{a}</Notice>)}

            {momento && momento.dias.some((d) => d.n > 0) && (
              <div>
                <div className="mb-1.5 text-[12px] font-bold text-ink-2">¿Qué día suele comprar esta audiencia?</div>
                <div className="flex h-16 items-end gap-1.5" role="img" aria-label="Distribución de la audiencia según su día de compra preferido">
                  {momento.dias.map((d) => (
                    <div key={d.id} className="flex h-full flex-1 flex-col items-center justify-end">
                      <div className={clsx('w-full rounded-t', diaSel === d.id ? 'bg-accent' : d.id === momento.mejor_dia ? 'bg-brand' : 'bg-brand/35')} style={{ height: `${Math.max(4, (100 * d.n) / maxDia)}%` }} title={`${DIAS[d.id]}: ${fmtNum(d.n)} personas`} />
                    </div>
                  ))}
                </div>
                <div className="mt-1 flex gap-1.5 text-center text-[10.5px] text-ink-3">{momento.dias.map((d) => <span key={d.id} className={clsx('flex-1', diaSel === d.id && 'font-bold text-ink')}>{DIAS[d.id].slice(0, 3)}</span>)}</div>
                {sug && <p className="mt-2 text-[11.5px] text-ink-3"><Sparkles size={11} className="mr-1 inline" />{sug.motivo}</p>}
              </div>
            )}
            {!momento && <p className="text-[11.5px] text-ink-3">Pase por el paso <b>Audiencia</b> para ver cuándo compran sus clientes y recibir un horario sugerido.</p>}
          </div>
        )}

        <div className="rounded-xl border border-line p-3.5">
          <div className="flex flex-wrap items-center gap-3">
            <FlaskConical size={17} className="text-ink-3" />
            <div className="min-w-0 flex-1 basis-56">
              <div className="text-[13px] font-bold text-ink">Grupo de control <span className="ml-1 rounded-full bg-good-soft px-2 py-0.5 text-[10.5px] font-semibold text-good">Recomendado 10 %</span></div>
              <p className="text-[11.5px] leading-snug text-ink-3">Reserva al azar una parte de la audiencia <b>sin enviarle nada</b>. Después se compara cuánto compraron con quienes sí recibieron el mensaje: así se sabe cuánto vendió <i>de verdad</i> la campaña y no lo que igual habrían comprado.</p>
            </div>
            <select aria-label="Porcentaje del grupo de control" value={valor.control} onChange={(e) => set({ control: Number(e.target.value) })} className="h-9 rounded-lg border border-line-strong bg-surface px-2 text-[13px]">
              {[0, 5, 10, 15, 20].map((n) => <option key={n} value={n}>{n === 0 ? 'Sin grupo de control' : `${n} % de la audiencia`}</option>)}
            </select>
          </div>
          {valor.control > 0 && audiencia > 0 && <p className="mt-2 text-[12px] text-ink-2">≈ <b>{fmtNum(nControl)}</b> personas quedarán sin mensaje y <b>{fmtNum(audiencia - nControl)}</b> lo recibirán. El costo se calcula solo sobre quienes lo reciben.</p>}
        </div>
      </div>
    </Card>
  )
}

export const fmtPrograma = (p: Programa) => (p.modo === 'ahora' ? 'ahora' : `${fmtProgramada(`${p.fecha}T${p.hora}:00`)}`)
