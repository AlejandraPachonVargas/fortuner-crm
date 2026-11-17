import { useMutation, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { CalendarClock, CalendarX2, Copy, Eye, FilePen, Megaphone, Pencil, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Badge, Btn, Card, ConfirmDialog, Empty, ErrorBox, IconBtn, SearchInput, Skeleton, Stat } from '@/components/ui'
import { api, useGet, type Campana } from '@/lib/api'
import { CANAL_LABEL, fmtCop, fmtFechaHora, fmtNum } from '@/lib/format'
import { fmtProgramada, textoVigencia } from '@/lib/programacion'

type Filtro = '' | 'borrador' | 'programada' | 'publicada'

export default function Historial() {
  const nav = useNavigate()
  const qc = useQueryClient()
  const [estado, setEstado] = useState<Filtro>('')
  const [q, setQ] = useState('')
  const [borrar, setBorrar] = useState<Campana | null>(null)
  const path = `/campanas?${new URLSearchParams({ ...(estado ? { estado } : {}), ...(q.trim() ? { q: q.trim() } : {}) })}`
  const { data, error, isLoading, refetch, isFetching } = useGet<{ items: Campana[] }>(path, { stale: 5_000 })
  const todas = useGet<{ items: Campana[] }>('/campanas', { stale: 5_000 }).data?.items ?? []

  const del = useMutation({
    mutationFn: (id: string) => api(`/campanas/${id}`, { method: 'DELETE' }),
    onSuccess: () => { void qc.invalidateQueries({ predicate: (x) => String(x.queryKey[0]).startsWith('/campanas') }); setBorrar(null) },
  })
  const dup = useMutation({
    mutationFn: (id: string) => api<Campana>(`/campanas/${id}/duplicar`, { method: 'POST' }),
    onSuccess: (c) => { void qc.invalidateQueries({ predicate: (x) => String(x.queryKey[0]).startsWith('/campanas') }); nav(`/campanas/${c.id}/editar`) },
  })

  const desprog = useMutation({
    mutationFn: (id: string) => api<Campana>(`/campanas/${id}/cancelar-programacion`, { method: 'POST' }),
    onSuccess: () => void qc.invalidateQueries({ predicate: (x) => String(x.queryKey[0]).startsWith('/campanas') }),
  })
  const programadas = todas.filter((c) => c.estado === 'programada').sort((a, b) => String(a.programada_para).localeCompare(String(b.programada_para)))
  const nPub = todas.filter((c) => c.estado === 'publicada').length
  const nBor = todas.filter((c) => c.estado === 'borrador').length
  const items = data?.items ?? []

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1 basis-72">
          <h1 className="text-[24px] font-semibold text-ink">Historial de campañas</h1>
          <p className="text-[13px] text-ink-3">Cada campaña elige productos, redacta el mensaje por canal y define a quién se le envía.</p>
        </div>
        <Btn variant="accent" icon={<Plus size={16} />} onClick={() => nav('/campanas/nueva')}>Crear campaña</Btn>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label="Campañas" value={fmtNum(todas.length)} />
        <Stat label="Programadas" value={fmtNum(programadas.length)} tone={programadas.length ? 'good' : undefined} sub={programadas[0] ? `Próxima: ${fmtProgramada(programadas[0].programada_para)}` : undefined} />
        <Stat label="Publicadas" value={fmtNum(nPub)} tone="good" />
        <Stat label="Borradores" value={fmtNum(nBor)} tone={nBor ? 'warn' : undefined} sub={nBor ? 'Sin lanzar' : undefined} />
        <Stat label="Inversión estimada" value={fmtCop(todas.filter((c) => c.estado === 'publicada').reduce((a, c) => a + c.costo_estimado, 0))} sub="Solo publicadas" />
      </div>

      <Card pad={false}>
        <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
          <div role="tablist" aria-label="Estado" className="flex rounded-lg border border-line-strong p-0.5">
            {([['', 'Todas'], ['borrador', 'Borradores'], ['programada', 'Programadas'], ['publicada', 'Publicadas']] as const).map(([v, l]) => (
              <button key={v} role="tab" aria-selected={estado === v} type="button" onClick={() => setEstado(v)}
                className={clsx('rounded-md px-3 py-1 text-[12.5px] font-semibold', estado === v ? 'bg-brand text-white' : 'text-ink-2 hover:bg-surface-hover')}>{l}</button>
            ))}
          </div>
          <div className="ml-auto w-full max-w-xs"><SearchInput value={q} onChange={setQ} placeholder="Buscar por nombre u objetivo…" /></div>
        </div>

        {error ? <div className="p-4"><ErrorBox error={error} onRetry={() => void refetch()} /></div>
          : isLoading ? <div className="space-y-2 p-4"><Skeleton h={56} /><Skeleton h={56} /><Skeleton h={56} /></div>
          : items.length === 0 ? (
            <Empty text={q || estado ? 'No hay campañas con ese filtro' : 'Aún no hay campañas'}
              hint={q || estado ? undefined : 'Cree la primera: elija productos, deje que la IA redacte el mensaje y segmente a quién enviarlo.'}
              action={!q && !estado ? <Btn variant="accent" icon={<Plus size={16} />} onClick={() => nav('/campanas/nueva')}>Crear campaña</Btn> : undefined} />
          ) : (
            <ul className={clsx('divide-y divide-line', isFetching && 'is-fetching')}>
              {items.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center gap-3 px-4 py-3 hover:bg-surface-hover/50">
                  <div className={clsx('grid h-10 w-10 shrink-0 place-items-center rounded-xl', c.estado === 'publicada' ? 'bg-good-soft text-good' : c.estado === 'programada' ? 'bg-info-soft text-info' : 'bg-warn-soft text-warn')}>
                    {c.estado === 'publicada' ? <Megaphone size={18} /> : c.estado === 'programada' ? <CalendarClock size={18} /> : <FilePen size={18} />}
                  </div>
                  <div className="min-w-0 flex-1 basis-60">
                    <Link to={c.estado === 'borrador' ? `/campanas/${c.id}/editar` : `/campanas/${c.id}`} className="block truncate text-[14px] font-bold text-ink hover:text-brand">{c.nombre}</Link>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-ink-3">
                      <Badge tone={c.estado === 'publicada' ? 'good' : c.estado === 'programada' ? 'brand' : 'warn'}>{c.estado === 'publicada' ? 'Publicada (simulada)' : c.estado === 'programada' ? <><CalendarClock size={11} />Programada · {fmtProgramada(c.programada_para)}</> : `Borrador · paso ${c.paso} de 4`}</Badge>
                      {c.estado !== 'borrador' && c.vigencia_desde && c.vigencia_hasta && <span className="text-[11.5px] text-ink-3">Válida {textoVigencia(c.vigencia_desde, c.vigencia_hasta)}</span>}
                      <span>{c.n_productos ?? 0} producto(s)</span>
                      {(c.mensaje.canales ?? []).length > 0 && <span>{(c.mensaje.canales ?? []).map((k) => CANAL_LABEL[k] ?? k).join(' · ')}</span>}
                      {c.audiencia > 0 && <span>{fmtNum(c.audiencia)} destinatarios</span>}
                      <span>{c.estado === 'publicada' ? `Publicada ${fmtFechaHora(c.publicada_en)}` : c.estado === 'programada' ? `Programada ${fmtFechaHora(c.actualizada)}` : `Editada ${fmtFechaHora(c.actualizada)}`}</span>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-0.5">
                    <IconBtn title="Ver" onClick={() => nav(`/campanas/${c.id}`)}><Eye size={16} /></IconBtn>
                    {c.estado === 'borrador'
                      ? <IconBtn title="Editar" onClick={() => nav(`/campanas/${c.id}/editar`)}><Pencil size={16} /></IconBtn>
                      : <IconBtn title="Duplicar como borrador" onClick={() => dup.mutate(c.id)}><Copy size={16} /></IconBtn>}
                    {c.estado === 'programada' && <IconBtn title="Cancelar programación (vuelve a borrador)" onClick={() => desprog.mutate(c.id)}><CalendarX2 size={16} /></IconBtn>}
                    <IconBtn title="Eliminar" danger onClick={() => setBorrar(c)}><Trash2 size={16} /></IconBtn>
                  </div>
                </li>
              ))}
            </ul>
          )}
      </Card>

      <ConfirmDialog open={!!borrar} title="Eliminar campaña" danger confirmLabel="Eliminar" busy={del.isPending}
        onCancel={() => setBorrar(null)} onConfirm={() => borrar && del.mutate(borrar.id)}>
        ¿Eliminar <b>{borrar?.nombre}</b>? Desaparecerá del historial. {borrar?.estado === 'publicada' && 'Como ya fue publicada, sus destinatarios dejarán de contarse para evitar saturar a los clientes.'}
        {del.error && <div className="mt-2 text-bad">{del.error.message}</div>}
      </ConfirmDialog>
    </div>
  )
}
