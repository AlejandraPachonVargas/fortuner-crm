import clsx from 'clsx'
import { ArrowLeft, CheckCircle2, CircleAlert, Gift, Save, Search, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Btn, Card, ErrorBox, Notice, Skeleton, inputCls } from '@/components/ui'
import { api, type Mensaje, type Producto, type Textos } from '@/lib/api'
import { puntajeCalidad, revisarCalidad } from '@/lib/calidad'
import { fmtCop, fmtFecha } from '@/lib/format'
import { fechaISO, textoVigencia, vigencia } from '@/lib/programacion'
import PasoMensaje from '../campanas/PasoMensaje'
import { useAccion, useAuto, useCatalogo, type Automatizacion, type Edicion, type Oferta, type TipoOferta } from './datos'

interface Borrador { nombre: string; desde: string; hasta: string; oferta: Oferta; validez_dias: number; canales: string[]; textos: Textos }

const nf = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 2 })
/** Texto automático de la oferta para los descuentos (el mismo que arma el servidor si se deja vacío). */
export function ofertaAuto(o: Pick<Oferta, 'tipo' | 'valor'>): string {
  if (o.tipo === 'descuento_pct' && o.valor) return `${nf.format(o.valor)}% de descuento en tu compra`
  if (o.tipo === 'descuento_valor' && o.valor) return `${fmtCop(o.valor).replace(/\s/g, '')} de descuento en tu compra`
  return ''
}

const masDias = (iso: string, n: number) => { const [y, m, d] = iso.split('-').map(Number); const f = new Date(y, m - 1, d + n); return fechaISO(f) }

/** Borrador de una edición nueva: continúa la última (mismos mensajes y oferta) desde el día siguiente a que termine. */
function nuevaDesde(a: Automatizacion, hoy: string): Borrador {
  const ult = [...a.ediciones].sort((x, y) => x.hasta.localeCompare(y.hasta)).at(-1)
  const desde = ult && ult.hasta >= hoy ? masDias(ult.hasta, 1) : hoy
  const anio = desde.slice(0, 4)
  return {
    nombre: `${a.tipo_nombre} ${anio}`, desde, hasta: `${anio}-12-31`,
    oferta: ult ? { ...ult.oferta } : { tipo: 'descuento_pct', valor: 10, descripcion: '10% de descuento en tu compra', productos: [], restringido: false },
    validez_dias: ult?.validez_dias ?? 7, canales: ult?.canales ?? ['whatsapp', 'email'], textos: ult?.textos ?? {},
  }
}

export default function EdicionEditor() {
  const { id, eid } = useParams()
  const { data: a, error, isLoading } = useAuto(id)
  if (isLoading) return <div className="mx-auto max-w-[1400px] space-y-3"><Skeleton h={60} /><Skeleton h={500} /></div>
  if (error || !a) return <div className="mx-auto max-w-3xl"><ErrorBox error={error ?? new Error('No existe')} /></div>
  const ed = eid === 'nueva' ? null : a.ediciones.find((e) => e.id === eid)
  if (eid !== 'nueva' && !ed) return <div className="mx-auto max-w-3xl"><ErrorBox error={new Error('La edición no existe o fue eliminada.')} /></div>
  return <Editor key={eid} a={a} ed={ed ?? null} />
}

function Editor({ a, ed }: { a: Automatizacion; ed: Edicion | null }) {
  const nav = useNavigate()
  const accion = useAccion()
  const { data: cat } = useCatalogo()
  const hoy = fechaISO(new Date())
  const [b, setB] = useState<Borrador>(() => ed ? { nombre: ed.nombre, desde: ed.desde, hasta: ed.hasta, oferta: ed.oferta, validez_dias: ed.validez_dias, canales: ed.canales, textos: ed.textos } : nuevaDesde(a, hoy))
  // Mientras no se escriba una descripción propia, la de los descuentos se arma sola con el valor.
  const [descPropia, setDescPropia] = useState(() => !!ed && ed.oferta.descripcion !== ofertaAuto(ed.oferta))
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<unknown>(null)
  const set = (p: Partial<Borrador>) => setB({ ...b, ...p })
  const setOferta = (p: Partial<Oferta>) => {
    const o = { ...b.oferta, ...p }
    if (!descPropia) o.descripcion = ofertaAuto(o)
    set({ oferta: o })
  }
  const mensaje: Mensaje = { modo: 'manual', prompt: '', tono: '', canales: b.canales, textos: b.textos, tokens: 0 }
  // Ejemplo de vigencia: desde hoy, o desde que empieza la edición si es futura.
  const base = b.desde && b.desde > hoy ? b.desde : hoy
  const ejemplo = vigencia(base, Math.max(1, b.validez_dias || 1))
  const textoEjemplo = textoVigencia(ejemplo.desde, ejemplo.hasta)
  const chequeos = useMemo(() => revisarCalidad(mensaje, b.oferta.productos, b.oferta.restringido), [b]) // eslint-disable-line react-hooks/exhaustive-deps
  const esDescuento = b.oferta.tipo === 'descuento_pct' || b.oferta.tipo === 'descuento_valor'

  const guardar = async () => {
    setBusy(true); setErr(null)
    try {
      const body = { ...b, oferta: { ...b.oferta, valor: esDescuento ? b.oferta.valor : null } }
      if (ed) await accion(`/automatizaciones/${a.id}/ediciones/${ed.id}`, { method: 'PUT', body })
      else await accion(`/automatizaciones/${a.id}/ediciones`, { method: 'POST', body })
      nav(`/automatizaciones/${a.id}`)
    } catch (e) { setErr(e); window.scrollTo({ top: 0 }) } finally { setBusy(false) }
  }

  return (
    <div className="mx-auto max-w-[1400px] space-y-5 pb-4">
      <button type="button" onClick={() => nav(`/automatizaciones/${a.id}`)} className="flex items-center gap-1.5 text-[13px] font-semibold text-ink-3 hover:text-ink"><ArrowLeft size={15} />{a.nombre}</button>
      <div>
        <h1 className="text-[24px] font-semibold text-ink">{ed ? `Editar «${ed.nombre}»` : 'Nueva edición'}</h1>
        <p className="text-[13px] text-ink-3">{a.tipo_nombre}: qué se ofrece y qué se dice en este periodo. Cada día usa la edición que lo cubre.</p>
      </div>
      {err != null && <ErrorBox error={err} />}

      <Card icon={<Gift size={18} />} title="Periodo y oferta">
        <div className="space-y-4">
          <div className="grid gap-3 md:grid-cols-[2fr_1fr_1fr]">
            <label className="text-[12px] font-semibold text-ink-2">Nombre de la edición
              <input className={clsx(inputCls, 'mt-1 font-normal')} value={b.nombre} maxLength={60} onChange={(e) => set({ nombre: e.target.value })} placeholder="Ej.: Cumpleaños 2027" /></label>
            <label className="text-[12px] font-semibold text-ink-2">Vigente desde
              <input type="date" className={clsx(inputCls, 'mt-1 font-normal')} value={b.desde} max={b.hasta || undefined} onChange={(e) => set({ desde: e.target.value })} /></label>
            <label className="text-[12px] font-semibold text-ink-2">Hasta
              <input type="date" className={clsx(inputCls, 'mt-1 font-normal')} value={b.hasta} min={b.desde || undefined} onChange={(e) => set({ hasta: e.target.value })} /></label>
          </div>

          <div>
            <div className="mb-1.5 text-[12px] font-semibold text-ink-2">Qué se ofrece</div>
            <div role="radiogroup" aria-label="Tipo de oferta" className="flex flex-wrap gap-1.5">
              {Object.entries(cat?.ofertas ?? {}).map(([id, label]) => (
                <button key={id} type="button" role="radio" aria-checked={b.oferta.tipo === id} onClick={() => setOferta({ tipo: id as TipoOferta })}
                  className={clsx('rounded-full border px-3 py-1.5 text-[12.5px] font-medium transition', b.oferta.tipo === id ? 'border-brand bg-brand text-white' : 'border-line-strong text-ink-2 hover:bg-surface-hover')}>{label}</button>
              ))}
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-[auto_1fr]">
            {esDescuento && (
              <label className="text-[12px] font-semibold text-ink-2">{b.oferta.tipo === 'descuento_pct' ? 'Porcentaje' : 'Valor en pesos'}
                <span className="mt-1 flex items-center gap-1.5">
                  {b.oferta.tipo === 'descuento_valor' && <span className="text-[13px] text-ink-2">$</span>}
                  <input type="number" min={1} max={b.oferta.tipo === 'descuento_pct' ? 100 : 100000000} step={b.oferta.tipo === 'descuento_pct' ? 1 : 1000}
                    value={b.oferta.valor ?? ''} onChange={(e) => setOferta({ valor: e.target.value === '' ? null : Number(e.target.value) })}
                    className={clsx(inputCls, 'font-normal tnum')} style={{ width: 150 }} />
                  {b.oferta.tipo === 'descuento_pct' && <span className="text-[13px] text-ink-2">%</span>}
                </span></label>
            )}
            <label className="text-[12px] font-semibold text-ink-2">Cómo se dice en el mensaje <span className="font-normal text-ink-3">(reemplaza a {'{oferta}'})</span>
              <input className={clsx(inputCls, 'mt-1 font-normal')} value={b.oferta.descripcion} maxLength={200}
                placeholder={b.oferta.tipo === 'regalo' ? 'Ej.: una torta de cumpleaños de regalo' : b.oferta.tipo === 'producto' ? 'Ej.: un vino de regalo en tu compra' : 'Describa el beneficio'}
                onChange={(e) => { setDescPropia(e.target.value.trim() !== ''); set({ oferta: { ...b.oferta, descripcion: e.target.value || ofertaAuto(b.oferta) } }) }} /></label>
          </div>

          {b.oferta.tipo === 'producto' && <ProductosOferta valor={b.oferta.productos} onChange={(p) => setOferta({ productos: p })} />}

          <div className="grid items-end gap-3 md:grid-cols-2">
            <label className="text-[12px] font-semibold text-ink-2">Validez de la oferta
              <span className="mt-1 flex items-center gap-2">
                <input type="number" min={1} max={90} value={b.validez_dias || ''} onChange={(e) => set({ validez_dias: Math.trunc(Number(e.target.value)) })} className={clsx(inputCls, 'font-normal tnum')} style={{ width: 96 }} />
                <span className="text-[13px] font-normal text-ink-2">días desde que se envía</span>
              </span>
              <span className="mt-1 block text-[11.5px] font-normal text-ink-3">Ejemplo: si se envía {base === hoy ? 'hoy' : `el ${fmtFecha(base)}`}, es válida {textoEjemplo}. Así aparece donde diga {'{vigencia}'}.</span></label>
            <label className="flex items-start gap-2 rounded-xl bg-surface-2 p-3 text-[12.5px] text-ink-2">
              <input type="checkbox" checked={b.oferta.restringido} onChange={(e) => setOferta({ restringido: e.target.checked })} className="mt-0.5 h-4 w-4 accent-[var(--brand)]" />
              <span><b className="text-ink">Incluye licor o cigarrillo.</b> Se excluyen los menores de edad. El CRM también lo detecta solo si la oferta o el mensaje los mencionan.</span>
            </label>
          </div>
        </div>
      </Card>

      <PasoMensaje mensaje={mensaje} onChange={(m) => set({ canales: m.canales, textos: m.textos })} productos={b.oferta.productos} temporadaId={null}
        sinIa oferta={b.oferta.descripcion || '{oferta}'} vigencia={textoEjemplo}
        marcadores={<>Marcadores: <code className="rounded bg-surface-2 px-1">{'{nombre}'}</code> el cliente, <code className="rounded bg-surface-2 px-1">{'{oferta}'}</code> lo que se ofrece y <code className="rounded bg-surface-2 px-1">{'{vigencia}'}</code> hasta cuándo vale.</>} />

      {chequeos.length > 0 && (
        <Card title="Calidad del mensaje" actions={<span className="text-[18px] font-extrabold tnum text-ink">{puntajeCalidad(chequeos)}<span className="text-[11px] font-semibold text-ink-3">/100</span></span>}>
          <ul className="grid gap-2 md:grid-cols-2">
            {chequeos.map((c) => (
              <li key={c.texto} className="flex items-start gap-2 text-[12.5px]">
                {c.ok ? <CheckCircle2 size={15} className="mt-0.5 shrink-0 text-good" /> : <CircleAlert size={15} className="mt-0.5 shrink-0 text-warn" />}
                <span className="min-w-0"><span className={c.ok ? 'text-ink-2' : 'font-semibold text-ink'}>{c.texto}</span>{!c.ok && c.ayuda && <span className="block text-[11.5px] text-ink-3">{c.ayuda}</span>}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <div className="sticky bottom-0 z-10 -mx-1 flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-surface/95 px-4 py-3 shadow-[0_-12px_32px_-24px_rgba(0,45,73,.5)] backdrop-blur">
        <span className="text-[12.5px] text-ink-3">Se guarda en la automatización «{a.nombre}». Una edición incompleta se puede guardar, pero no se envía.</span>
        <div className="ml-auto flex gap-2">
          <Btn variant="ghost" onClick={() => nav(`/automatizaciones/${a.id}`)}>Cancelar</Btn>
          <Btn variant="primary" icon={<Save size={15} />} busy={busy} onClick={() => void guardar()}>Guardar edición</Btn>
        </div>
      </div>
    </div>
  )
}

/** Buscador de productos del ERP para una oferta de producto (máximo 20). */
function ProductosOferta({ valor, onChange }: { valor: Producto[]; onChange: (p: Producto[]) => void }) {
  const [q, setQ] = useState('')
  const [res, setRes] = useState<Producto[]>([])
  const [err, setErr] = useState<unknown>(null)
  const t = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (t.current) clearTimeout(t.current)
    if (q.trim().length < 3) { setRes([]); return }
    t.current = setTimeout(() => {
      api<{ items: Producto[] }>('/campanas/productos/buscar', { method: 'POST', body: { q, solo_activos: true } })
        .then((r) => { setRes(r.items.slice(0, 8)); setErr(null) }).catch(setErr)
    }, 350)
  }, [q])
  return (
    <div>
      <div className="mb-1.5 text-[12px] font-semibold text-ink-2">Productos de la oferta <span className="font-normal text-ink-3">(opcional: sirven para medir si los compraron)</span></div>
      <div className="relative max-w-xl">
        <Search size={15} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-3" />
        <input className={clsx(inputCls, 'pl-9')} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar producto por nombre o código (mínimo 3 letras)" aria-label="Buscar producto" />
        {res.length > 0 && (
          <ul className="absolute top-11 right-0 left-0 z-30 max-h-72 overflow-y-auto rounded-2xl border border-line bg-surface p-1.5 shadow-lg scroll-thin">
            {res.map((p) => (
              <li key={p.producto_id}>
                <button type="button" disabled={valor.length >= 20 || valor.some((x) => x.producto_id === p.producto_id)}
                  onClick={() => { onChange([...valor, p]); setQ('') }}
                  className="flex w-full items-center justify-between gap-3 rounded-lg px-2.5 py-2 text-left text-[12.5px] hover:bg-surface-hover disabled:opacity-50">
                  <span className="truncate">{p.producto}</span><span className="shrink-0 text-ink-3 tnum">{fmtCop(p.precio_venta)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {err != null && <div className="mt-2"><Notice tone="warn">No se pudo buscar productos (¿hay ventas cargadas del ERP?).</Notice></div>}
      {valor.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {valor.map((p) => (
            <span key={p.producto_id} className="inline-flex items-center gap-1.5 rounded-full bg-surface-2 py-1 pr-1 pl-2.5 text-[12px] text-ink-2">
              {p.producto}
              <button type="button" aria-label={`Quitar ${p.producto}`} onClick={() => onChange(valor.filter((x) => x.producto_id !== p.producto_id))} className="grid h-5 w-5 place-items-center rounded-full hover:bg-surface-hover"><X size={12} /></button>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
