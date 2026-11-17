import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, CalendarX2, Copy, Pencil } from 'lucide-react'
import { useNavigate, useParams } from 'react-router-dom'
import { Badge, Btn, ErrorBox, Notice, Skeleton } from '@/components/ui'
import { api, useGet, type Campana } from '@/lib/api'
import { fmtFechaHora, fmtNum } from '@/lib/format'
import { fmtProgramada, textoVigencia } from '@/lib/programacion'
import ResumenCampana from './ResumenCampana'

/** «Ver»: resumen de solo lectura de una campaña (borrador o publicada). */
export default function Detalle() {
  const { id } = useParams()
  const nav = useNavigate()
  const qc = useQueryClient()
  const { data: c, error, isLoading, refetch } = useGet<Campana>(`/campanas/${id}`, { stale: 0 })
  const dup = useMutation({
    mutationFn: () => api<Campana>(`/campanas/${id}/duplicar`, { method: 'POST' }),
    onSuccess: (n) => { void qc.invalidateQueries({ predicate: (x) => String(x.queryKey[0]).startsWith('/campanas') }); nav(`/campanas/${n.id}/editar`) },
  })

  const desprog = useMutation({
    mutationFn: () => api<Campana>(`/campanas/${id}/cancelar-programacion`, { method: 'POST' }),
    onSuccess: () => { void qc.invalidateQueries({ predicate: (x) => String(x.queryKey[0]).startsWith('/campanas') }); nav(`/campanas/${id}/editar`) },
  })

  if (isLoading) return <div className="mx-auto max-w-6xl space-y-3"><Skeleton h={60} /><Skeleton h={300} /></div>
  const vig = c?.vigencia_desde && c.vigencia_hasta ? textoVigencia(c.vigencia_desde, c.vigencia_hasta) : null
  if (error || !c) return <div className="mx-auto max-w-3xl space-y-3"><ErrorBox error={error ?? new Error('Campaña no encontrada')} onRetry={() => void refetch()} /><Btn onClick={() => nav('/campanas')}>Volver</Btn></div>

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Btn variant="ghost" icon={<ArrowLeft size={15} />} onClick={() => nav('/campanas')}>Historial</Btn>
        <div className="min-w-0 flex-1 basis-72">
          <h1 className="truncate text-[24px] font-semibold text-ink">{c.nombre}</h1>
          <div className="flex flex-wrap items-center gap-2 text-[12px] text-ink-3">
            <Badge tone={c.estado === 'publicada' ? 'good' : c.estado === 'programada' ? 'brand' : 'warn'}>{c.estado === 'publicada' ? 'Publicada (simulada)' : c.estado === 'programada' ? `Programada · ${fmtProgramada(c.programada_para)}` : 'Borrador'}</Badge>
            <span>Creada {fmtFechaHora(c.creada)}</span>
            {c.publicada_en && <span>· Publicada {fmtFechaHora(c.publicada_en)}</span>}
            {vig && <Badge tone="brand">Válida {vig}</Badge>}
          </div>
        </div>
        {c.estado === 'borrador'
          ? <Btn variant="primary" icon={<Pencil size={15} />} onClick={() => nav(`/campanas/${c.id}/editar`)}>Continuar editando</Btn>
          : <div className="flex gap-2">
              {c.estado === 'programada' && <Btn icon={<CalendarX2 size={15} />} busy={desprog.isPending} onClick={() => desprog.mutate()}>Cancelar programación</Btn>}
              <Btn icon={<Copy size={15} />} busy={dup.isPending} onClick={() => dup.mutate()}>Duplicar como borrador</Btn>
            </div>}
      </div>
      {c.estado === 'programada' && <Notice tone="info">Se publicará sola el <b>{fmtProgramada(c.programada_para)}</b> (hora del servidor) para <b>{fmtNum(c.grupos?.envio ?? c.audiencia)}</b> personas
        {(c.grupos?.control ?? 0) > 0 && <> y deja <b>{fmtNum(c.grupos?.control)}</b> como grupo de control sin envío</>}. Publicación simulada: no se enviará ningún mensaje real. Mientras tanto sus destinatarios quedan reservados para no saturarlos con otra campaña.</Notice>}
      {c.estado === 'publicada' && (c.grupos?.control ?? 0) > 0 && <Notice tone="info">Grupo de control: <b>{fmtNum(c.grupos?.control)}</b> personas ({c.control_pct}%) quedaron sin mensaje para poder medir el efecto real de la campaña.</Notice>}
      {c.estado === 'publicada' && <Notice tone="info">Publicación simulada: no se envió ningún mensaje real. La lista de destinatarios quedó registrada para no volver a contactarlos en campañas cercanas.</Notice>}
      <ResumenCampana calidad={c.estado === 'borrador'} d={{ nombre: c.nombre, objetivo: c.objetivo, productos: c.productos, mensaje: c.mensaje, filtros: c.segmentacion?.filtros ?? {}, audiencia: c.audiencia, costo: c.costo_estimado, vigencia: vig }} />
    </div>
  )
}
