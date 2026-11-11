import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Copy, Pencil } from 'lucide-react'
import { useNavigate, useParams } from 'react-router-dom'
import { Badge, Btn, ErrorBox, Notice, Skeleton } from '@/components/ui'
import { api, useGet, type Campana } from '@/lib/api'
import { fmtFechaHora } from '@/lib/format'
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

  if (isLoading) return <div className="mx-auto max-w-6xl space-y-3"><Skeleton h={60} /><Skeleton h={300} /></div>
  if (error || !c) return <div className="mx-auto max-w-3xl space-y-3"><ErrorBox error={error ?? new Error('Campaña no encontrada')} onRetry={() => void refetch()} /><Btn onClick={() => nav('/campanas')}>Volver</Btn></div>

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Btn variant="ghost" icon={<ArrowLeft size={15} />} onClick={() => nav('/campanas')}>Historial</Btn>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-[20px] font-bold text-ink">{c.nombre}</h1>
          <div className="flex flex-wrap items-center gap-2 text-[12px] text-ink-3">
            <Badge tone={c.estado === 'publicada' ? 'good' : 'warn'}>{c.estado === 'publicada' ? 'Publicada (simulada)' : 'Borrador'}</Badge>
            <span>Creada {fmtFechaHora(c.creada)}</span>
            {c.publicada_en && <span>· Publicada {fmtFechaHora(c.publicada_en)}</span>}
          </div>
        </div>
        {c.estado === 'borrador'
          ? <Btn variant="primary" icon={<Pencil size={15} />} onClick={() => nav(`/campanas/${c.id}/editar`)}>Continuar editando</Btn>
          : <Btn icon={<Copy size={15} />} busy={dup.isPending} onClick={() => dup.mutate()}>Duplicar como borrador</Btn>}
      </div>
      {c.estado === 'publicada' && <Notice tone="info">Publicación simulada: no se envió ningún mensaje real. La lista de destinatarios quedó registrada para no volver a contactarlos en campañas cercanas.</Notice>}
      <ResumenCampana d={{ nombre: c.nombre, objetivo: c.objetivo, productos: c.productos, mensaje: c.mensaje, filtros: c.segmentacion?.filtros ?? {}, audiencia: c.audiencia, costo: c.costo_estimado }} />
    </div>
  )
}
