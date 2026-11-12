import { CheckCircle2, CircleAlert, Package, Target, Wallet } from 'lucide-react'
import { Badge, Card, Notice, Stat } from '@/components/ui'
import type { Mensaje, Preview, Producto } from '@/lib/api'
import VistaCanales from '@/components/VistaCanales'
import { revisarCalidad, puntajeCalidad } from '@/lib/calidad'
import { CANAL_LABEL, fmtCop, fmtNum } from '@/lib/format'

export interface DatosCampana {
  nombre: string; objetivo: string; productos: Producto[]; mensaje: Partial<Mensaje>; filtros: Record<string, unknown>
  audiencia: number; costo: number; preview?: Preview | null
}

const NOMBRES: Record<string, string> = {
  segmentos_rfm: 'Tipo de cliente', ciclo: 'Momento de compra', sexo: 'Género', edades: 'Edad', clubs: 'Clubes', dias_pref: 'Día de compra',
  franjas: 'Franja', valor: 'Valor', descuento: 'Descuentos', afinidad_requerida: 'Afinidad', afinidad_minima: 'Puntaje mínimo',
  min_visitas: 'Mín. visitas', max_dias_sin_compra: 'Compró en últimos (días)', excluir_contactados_dias: 'Sin contacto reciente (días)', tope_contactos: 'Tope de personas',
}
const DIAS = ['', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']

/** Chips legibles con los filtros de segmentación activos. */
export function filtrosActivos(f: Record<string, unknown>): { k: string; v: string }[] {
  const out: { k: string; v: string }[] = []
  for (const [k, label] of Object.entries(NOMBRES)) {
    const v = f[k]
    if (Array.isArray(v) && v.length) out.push({ k: label, v: v.map((x) => (k === 'dias_pref' ? DIAS[Number(x)] : String(x))).join(', ') })
    else if (!Array.isArray(v) && v !== '' && v != null && v !== 0 && v !== false) out.push({ k: label, v: String(v) })
  }
  return out
}

/** Problemas que impiden publicar (vacío = lista para publicar). */
export function pendientes(d: DatosCampana): string[] {
  const p: string[] = []
  const m = d.mensaje
  const canales = m.canales ?? []
  if (!d.nombre.trim()) p.push('Falta el nombre de la campaña.')
  if (d.productos.length === 0) p.push('Seleccione al menos un producto.')
  if (canales.length === 0) p.push('Elija al menos un canal de difusión.')
  for (const c of canales) {
    const t = m.textos?.[c as 'whatsapp' | 'sms' | 'email']
    const ok = c === 'email' ? Boolean((t as { cuerpo?: string } | undefined)?.cuerpo?.trim() && (t as { asunto?: string } | undefined)?.asunto?.trim()) : Boolean((t as { texto?: string } | undefined)?.texto?.trim())
    if (!ok) p.push(`Falta el mensaje de ${CANAL_LABEL[c]}.`)
  }
  if (d.preview && d.preview.resumen.audiencia === 0) p.push('La segmentación no deja ningún destinatario.')
  return p
}

export default function ResumenCampana({ d, calidad = true }: { d: DatosCampana; calidad?: boolean }) {
  const m = d.mensaje
  const canales = m.canales ?? []
  const activos = filtrosActivos(d.filtros)
  const r = d.preview?.resumen
  const audiencia = r?.audiencia ?? d.audiencia
  const costo = r?.costo_estimado ?? d.costo
  const capital = d.productos.reduce((a, p) => a + (p.precio_venta || 0), 0)

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Productos" value={fmtNum(d.productos.length)} sub={d.productos.length ? `Suma de precios ${fmtCop(capital)}` : undefined} />
        <Stat label="Canales" value={canales.length ? canales.map((c) => CANAL_LABEL[c]).join(' · ') : '—'} />
        <Stat label="Destinatarios" value={fmtNum(audiencia)} />
        <Stat label="Costo estimado" value={fmtCop(costo)} sub={audiencia ? `${fmtCop(costo / audiencia)} por persona` : undefined} />
      </div>
      {d.productos.some((p) => !(p.precio_venta > 0)) && (
        <Notice tone="warn">{d.productos.filter((p) => !(p.precio_venta > 0)).length} producto(s) no tienen precio de venta en el ERP: el mensaje no debe mencionar su precio. Revíselo con Compras o retírelos.</Notice>
      )}
      {d.objetivo && <p className="rounded-xl bg-surface-2 px-4 py-3 text-[13px] text-ink-2"><b className="text-ink">Objetivo: </b>{d.objetivo}</p>}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="1 · Productos" actions={<Package size={16} className="text-ink-3" />} pad={false}>
          {d.productos.length === 0 ? <p className="p-4 text-[13px] text-ink-3">Sin productos.</p> : (
            <ul className="max-h-80 divide-y divide-line overflow-y-auto scroll-thin">
              {d.productos.map((p) => (
                <li key={p.producto_id} className="px-4 py-2.5">
                  <div className="flex items-baseline gap-2"><span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-ink">{p.producto}</span><span className="text-[12px] font-semibold tnum text-ink-2">{p.precio_venta > 0 ? fmtCop(p.precio_venta) : 'Sin precio'}</span></div>
                  {p.razon && <p className="mt-0.5 text-[11.5px] text-ink-3">{p.razon}</p>}
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="3 · Audiencia" actions={<Target size={16} className="text-ink-3" />}>
          {activos.length === 0 ? <p className="text-[13px] text-ink-2">Sin segmentadores: todos los clientes contactables con autorización.</p> : (
            <dl className="space-y-1.5 text-[12.5px]">
              {activos.map((a) => <div key={a.k} className="flex gap-2"><dt className="w-40 shrink-0 text-ink-3">{a.k}</dt><dd className="min-w-0 flex-1 font-medium text-ink">{a.v}</dd></div>)}
            </dl>
          )}
          {r && (
            <div className="mt-3 flex flex-wrap gap-1.5 border-t border-line pt-3">
              {Object.entries(r.por_canal).map(([c, n]) => <Badge key={c} tone="brand">{CANAL_LABEL[c]}: {fmtNum(n)}</Badge>)}
              <Badge>Puntaje medio {r.puntaje_promedio}</Badge>
            </div>
          )}
          {d.preview?.restricciones.excluye_menores && <div className="mt-3"><Notice tone="warn">Incluye productos de venta restringida: se excluyen menores de edad y clientes sin fecha de nacimiento.</Notice></div>}
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
        <Card title="2 · Así lo verá el cliente" actions={<Wallet size={16} className="text-ink-3" />}>
          <VistaCanales mensaje={m} productos={d.productos} />
          {(m.tokens ?? 0) > 0 && <p className="mt-3 text-[11.5px] text-ink-3">Redactado con IA · {fmtNum(m.tokens)} tokens consumidos.</p>}
          {m.modo === 'manual' && <p className="mt-3 text-[11.5px] text-ink-3">Redacción propia (sin IA, sin tokens).</p>}
        </Card>
        {calidad && <CalidadMensaje m={m} productos={d.productos} restringido={Boolean(d.preview?.restricciones.excluye_menores)} />}
      </div>
    </div>
  )
}

/** Lista de verificación de calidad y cumplimiento del mensaje (recomendaciones; no bloquea la publicación). */
function CalidadMensaje({ m, productos, restringido }: { m: Partial<Mensaje>; productos: Producto[]; restringido: boolean }) {
  const chequeos = revisarCalidad(m, productos, restringido)
  const pct = puntajeCalidad(chequeos)
  const tono = pct >= 85 ? 'text-good' : pct >= 60 ? 'text-warn' : 'text-bad'
  return (
    <Card title="Calidad del mensaje" subtitle="Buenas prácticas de marketing y cumplimiento"
      actions={chequeos.length ? <span className={`text-[18px] font-extrabold tnum ${tono}`}>{pct}<span className="text-[11px] font-semibold text-ink-3">/100</span></span> : undefined}>
      {chequeos.length === 0 ? <p className="text-[13px] text-ink-3">Redacte el mensaje para ver la revisión.</p> : (
        <ul className="space-y-2">
          {chequeos.map((c) => (
            <li key={c.texto} className="flex items-start gap-2 text-[12.5px]">
              {c.ok ? <CheckCircle2 size={15} className="mt-0.5 shrink-0 text-good" /> : <CircleAlert size={15} className="mt-0.5 shrink-0 text-warn" />}
              <span className="min-w-0"><span className={c.ok ? 'text-ink-2' : 'font-semibold text-ink'}>{c.texto}</span>{!c.ok && c.ayuda && <span className="block text-[11.5px] text-ink-3">{c.ayuda}</span>}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}
