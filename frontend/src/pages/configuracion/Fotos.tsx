import clsx from 'clsx'
import { BadgeCheck, ChevronLeft, ChevronRight, ImagePlus, Package, Search, ShieldQuestion, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Badge, Btn, Card, Empty, ErrorBox, Skeleton, inputCls } from '@/components/ui'
import { api, subirArchivo, useConfigGeneral, useGet, useInvalidate } from '@/lib/api'
import { fmtCop, fmtFecha, fmtNum } from '@/lib/format'

interface FotoInfo { origen: 'subida' | 'importada'; codigo_archivo?: string; verificada_por?: string; verificada_en?: string; subida_por?: string; v?: number }
interface Item { producto_id: string; producto: string; ean: string | null; marca: string; grupo: string; precio_venta: number; activo: boolean; unidades_90d: number; foto: FotoInfo | null }
interface Lista { total: number; pagina: number; por_pagina: number; items: Item[]; resumen: { con_foto: number; verificadas: number } }

const FILTROS = [
  { id: 'sin_foto', label: 'Se venden y no tienen foto' },
  { id: 'sin_verificar', label: 'Con foto sin verificar' },
  { id: 'verificadas', label: 'Verificadas' },
  { id: 'todas', label: 'Todos los productos' },
] as const

/** Revisión de fotos producto por producto: verificar, cambiar o quitar. */
export default function Fotos() {
  const [filtro, setFiltro] = useState<string>('sin_foto')
  const [q, setQ] = useState('')
  const [buscar, setBuscar] = useState('')
  const [pagina, setPagina] = useState(1)
  useEffect(() => { const t = setTimeout(() => { setBuscar(q.trim()); setPagina(1) }, 350); return () => clearTimeout(t) }, [q])
  const ruta = `/configuracion/fotos?filtro=${filtro}&q=${encodeURIComponent(buscar)}&pagina=${pagina}`
  const l = useGet<Lista>(ruta, { stale: 0 })
  const g = useConfigGeneral()
  const admin = Boolean(g.data?.puede_editar)
  const paginas = l.data ? Math.max(1, Math.ceil(l.data.total / l.data.por_pagina)) : 1
  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative min-w-[240px] flex-1">
            <Search size={15} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-3" />
            <input aria-label="Buscar producto" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por nombre, código de barras o código del ERP" className={clsx(inputCls, 'pl-9')} />
          </div>
          <div role="radiogroup" aria-label="Qué productos ver" className="flex flex-wrap gap-1.5">
            {FILTROS.map((f) => (
              <button key={f.id} type="button" role="radio" aria-checked={filtro === f.id} onClick={() => { setFiltro(f.id); setPagina(1) }}
                className={clsx('rounded-full border px-3 py-1.5 text-[12.5px] font-medium transition', filtro === f.id ? 'border-brand bg-brand text-white' : 'border-line-strong text-ink-2 hover:bg-surface-hover')}>{f.label}</button>
            ))}
          </div>
        </div>
        {l.data && <p className="mt-3 text-[12px] text-ink-3"><b className="text-ink">{fmtNum(l.data.total)}</b> productos en esta vista · {fmtNum(l.data.resumen.con_foto)} con foto, de ellas {fmtNum(l.data.resumen.verificadas)} verificadas.{!admin && ' Para cambiar fotos entre con la clave de administración.'}</p>}
      </Card>
      {l.error != null && <ErrorBox error={l.error} onRetry={() => void l.refetch()} />}
      {!l.data ? <Skeleton h={320} /> : l.data.items.length === 0 ? <Empty text="No hay productos en esta vista" /> : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {l.data.items.map((it) => <Tarjeta key={it.producto_id} it={it} admin={admin} />)}
        </div>
      )}
      {l.data && paginas > 1 && (
        <div className="flex items-center justify-center gap-3 text-[12.5px] text-ink-2">
          <Btn small variant="ghost" icon={<ChevronLeft size={14} />} disabled={pagina <= 1} onClick={() => setPagina(pagina - 1)}>Anterior</Btn>
          Página {pagina} de {fmtNum(paginas)}
          <Btn small variant="ghost" disabled={pagina >= paginas} onClick={() => setPagina(pagina + 1)}>Siguiente <ChevronRight size={14} /></Btn>
        </div>
      )}
    </div>
  )
}

function Tarjeta({ it, admin }: { it: Item; admin: boolean }) {
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState('')
  const [err, setErr] = useState<unknown>(null)
  const inval = useInvalidate()
  const f = it.foto
  const listo = () => { inval('/configuracion/fotos'); inval('/productos') }
  const hacer = async (que: string, fn: () => Promise<unknown>) => {
    setBusy(que); setErr(null)
    try { await fn(); listo() } catch (e) { setErr(e) } finally { setBusy(''); if (input.current) input.current.value = '' }
  }
  const subir = (archivo?: File) => archivo && void hacer('subir', () => subirArchivo(`/configuracion/fotos/${it.producto_id}`, archivo))
  return (
    <div className="flex flex-col overflow-hidden rounded-2xl border border-line bg-surface">
      <div className="relative grid aspect-square place-items-center bg-white">
        {f ? <img src={`/media/productos/${it.producto_id}.webp?v=${f.v ?? 'i'}`} alt={it.producto} loading="lazy" className="h-full w-full object-contain p-3" />
          : <div className="flex flex-col items-center gap-1 text-ink-3"><Package size={40} strokeWidth={1.4} /><span className="text-[12px]">Sin foto</span></div>}
        {f && <span className="absolute top-2 left-2">{f.verificada_en
          ? <Badge tone="good" title={`Verificada por ${f.verificada_por} el ${fmtFecha(f.verificada_en.slice(0, 10))}`}><BadgeCheck size={12} />Verificada</Badge>
          : <Badge tone="warn"><ShieldQuestion size={12} />Sin verificar</Badge>}</span>}
      </div>
      <div className="flex flex-1 flex-col gap-1 border-t border-line p-3">
        <div className="text-[13px] leading-snug font-semibold text-ink">{it.producto}</div>
        <div className="text-[11.5px] text-ink-3">Código de barras <b className="tnum text-ink-2">{it.ean || '—'}</b> · ERP <span className="tnum">{it.producto_id}</span></div>
        <div className="text-[11.5px] text-ink-3">{it.grupo} · {fmtCop(it.precio_venta)} · {fmtNum(it.unidades_90d)} uds en 90 d{it.activo ? '' : ' · inactivo'}</div>
        {f && <div className="text-[11px] text-ink-3">{f.origen === 'subida' ? `Subida por ${f.subida_por}` : `Importada (archivo ${f.codigo_archivo ?? '—'})`}</div>}
        {admin && (
          <div className="mt-auto flex flex-wrap gap-1.5 pt-2">
            <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => subir(e.target.files?.[0])} />
            {f && !f.verificada_en && <Btn small variant="primary" icon={<BadgeCheck size={14} />} busy={busy === 'ver'} onClick={() => void hacer('ver', () => api(`/configuracion/fotos/${it.producto_id}/verificar?ok=true`, { method: 'POST' }))}>Es correcta</Btn>}
            <Btn small variant="secondary" icon={<ImagePlus size={14} />} busy={busy === 'subir'} onClick={() => input.current?.click()}>{f ? 'Cambiar' : 'Subir foto'}</Btn>
            {f && <Btn small variant="ghost" icon={<Trash2 size={14} />} busy={busy === 'borrar'} onClick={() => void hacer('borrar', () => api(`/configuracion/fotos/${it.producto_id}`, { method: 'DELETE' }))}>Quitar</Btn>}
          </div>
        )}
        {err != null && <ErrorBox error={err} />}
      </div>
    </div>
  )
}
