import clsx from 'clsx'
import { Package } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useGet } from '@/lib/api'

interface Disponibles { version: number; ids: string[]; versiones?: Record<string, number> }

/** Qué productos tienen foto (una sola consulta para toda la app; se refresca cada 10 minutos). */
export function useFotos() {
  const q = useGet<Disponibles>('/productos/imagenes', { stale: 600_000 })
  return useMemo(() => ({ ids: new Set(q.data?.ids ?? []), version: q.data?.version ?? 0, versiones: q.data?.versiones ?? {} }), [q.data])
}

export const urlFoto = (id: string, version: number, mini = false) =>
  `/media/productos/${encodeURIComponent(id)}.webp?v=${version}${mini ? '&t=mini' : ''}`

interface Props { id: string; nombre: string; size?: number; grande?: boolean; className?: string }

/** Foto del producto (WebP optimizado). Sin foto, o si no carga, muestra un ícono neutro del mismo tamaño. */
export default function FotoProducto({ id, nombre, size = 48, grande = false, className }: Props) {
  const { ids, version: vGlobal, versiones } = useFotos()
  const version = versiones[id] ?? vGlobal
  const [fallo, setFallo] = useState(false)
  const caja = clsx('grid shrink-0 place-items-center overflow-hidden rounded-lg border border-line bg-white', className)
  if (!ids.has(id) || fallo) {
    return (
      <div className={clsx(caja, 'bg-surface-2 text-ink-3')} style={{ width: size, height: size }} title="Sin foto">
        <Package size={Math.max(14, Math.round(size * 0.42))} strokeWidth={1.6} />
      </div>
    )
  }
  return (
    <div className={caja} style={{ width: size, height: size }}>
      <img src={urlFoto(id, version, !grande && size <= 120)} alt={nombre} title={nombre} loading="lazy" decoding="async"
        width={size} height={size} onError={() => setFallo(true)} className="h-full w-full object-contain" />
    </div>
  )
}
