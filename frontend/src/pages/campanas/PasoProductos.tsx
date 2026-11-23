import clsx from 'clsx'
import { Boxes, Calculator, CalendarDays, Check, Info, Plus, Search, Sparkles, TrendingDown, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import FotoProducto from '@/components/FotoProducto'
import { Badge, Btn, Card, Empty, ErrorBox, Field, MultiSelect, Notice, SearchInput, Skeleton, Spinner } from '@/components/ui'
import { api, useGet, type CalculoDescuento, type Filtros, type Producto, type Temporada } from '@/lib/api'
import { fmtCop, fmtFecha, fmtNum } from '@/lib/format'

interface Props { value: Producto[]; onChange: (p: Producto[]) => void; temporadaId: string | null; onTemporada: (id: string | null) => void }

const snapshot = (p: Producto): Producto => ({
  producto_id: p.producto_id, producto: p.producto, marca: p.marca, precio_venta: p.precio_venta, familia: p.familia, grupo: p.grupo,
  stock_actual: p.stock_actual, razon: p.razon,
})

type Tab = 'temporada' | 'inventario' | 'manual'

export default function PasoProductos({ value, onChange, temporadaId, onTemporada }: Props) {
  const [tab, setTab] = useState<Tab>('temporada')
  const sel = useMemo(() => new Set(value.map((p) => p.producto_id)), [value])
  const toggle = useCallback((p: Producto) => {
    onChange(sel.has(p.producto_id) ? value.filter((x) => x.producto_id !== p.producto_id) : [...value, snapshot(p)])
  }, [sel, value, onChange])
  const addMany = (ps: Producto[]) => onChange([...value, ...ps.filter((p) => !sel.has(p.producto_id)).map(snapshot)])

  return (
    <div className="space-y-4">
      <div role="tablist" aria-label="Origen de los productos" className="inline-flex max-w-full flex-wrap gap-1 rounded-2xl border border-line bg-surface-2 p-1">
        {([['temporada', CalendarDays, 'Sugeridos por temporada (IA)'], ['inventario', TrendingDown, 'Por inventario y rotación'], ['manual', Search, 'Búsqueda manual con filtros']] as const).map(([id, Icon, label]) => (
          <button key={id} role="tab" aria-selected={tab === id} type="button" onClick={() => setTab(id)}
            className={clsx('flex items-center gap-2 rounded-xl px-3.5 py-2 text-[13px] font-semibold transition', tab === id ? 'bg-surface text-brand shadow-sm' : 'text-ink-2 hover:text-ink')}>
            <Icon size={16} />{label}
          </button>
        ))}
      </div>
      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
      <div className="min-w-0 space-y-4">
        {tab === 'temporada' && <TabTemporada sel={sel} toggle={toggle} addMany={addMany} temporadaId={temporadaId} onTemporada={onTemporada} />}
        {tab === 'inventario' && <TabInventario sel={sel} toggle={toggle} addMany={addMany} />}
        {tab === 'manual' && <TabManual sel={sel} toggle={toggle} addMany={addMany} />}
      </div>

      <aside className="xl:sticky xl:top-0 xl:self-start">
        <Card title={`Productos de la campaña (${value.length})`} subtitle={value.length ? `Precio promedio ${fmtCop(value.reduce((a, p) => a + p.precio_venta, 0) / value.length)}` : undefined}
          actions={value.length > 0 ? <Btn small variant="ghost" onClick={() => onChange([])}>Vaciar</Btn> : undefined} pad={false}>
          {value.length === 0 ? <Empty text="Aún no ha elegido productos" hint="Marque los que quiera en cualquiera de las tres pestañas." />
            : (
              <ul className="max-h-[60vh] divide-y divide-line overflow-y-auto scroll-thin">
                {value.map((p) => (
                  <li key={p.producto_id} className="flex items-center gap-2.5 px-4 py-2">
                    <FotoProducto id={p.producto_id} nombre={p.producto} size={36} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[12.5px] font-semibold text-ink" title={p.producto}>{p.producto}</div>
                      <div className="truncate text-[11.5px] text-ink-3">{p.marca} · {fmtCop(p.precio_venta)}</div>
                    </div>
                    <button type="button" aria-label={`Quitar ${p.producto}`} title="Quitar" onClick={() => onChange(value.filter((x) => x.producto_id !== p.producto_id))}
                      className="grid h-6 w-6 shrink-0 place-items-center rounded-md text-ink-3 hover:bg-surface-hover hover:text-bad"><X size={14} /></button>
                  </li>
                ))}
              </ul>
            )}
        </Card>
      </aside>
      </div>
    </div>
  )
}

// ------------------------------------------------------------------------------ fila de producto
interface FilaProps { p: Producto; checked: boolean; onToggle: () => void; extra?: React.ReactNode }

function ProductoFila({ p, checked, onToggle, extra }: FilaProps) {
  return (
    <li className={clsx('flex items-start gap-3 px-4 py-3 transition', checked ? 'bg-brand-soft/60' : 'hover:bg-surface-hover/60')}>
      <button type="button" role="checkbox" aria-checked={checked} aria-label={`Seleccionar ${p.producto}`} onClick={onToggle}
        className={clsx('mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-md border transition', checked ? 'border-brand bg-brand text-white' : 'border-line-strong bg-surface hover:border-brand')}>
        {checked && <Check size={13} strokeWidth={3.5} />}
      </button>
      <button type="button" tabIndex={-1} aria-hidden onClick={onToggle} className="shrink-0"><FotoProducto id={p.producto_id} nombre={p.producto} size={64} /></button>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2"><span className="text-[13px] font-semibold text-ink">{p.producto}</span><span className="text-[11.5px] text-ink-3">{p.marca}</span>
          {p.activo === false && <Badge tone="warn" title="El ERP lo tiene marcado como inactivo. Verifique que se siga vendiendo antes de promocionarlo.">Inactivo en el ERP</Badge>}</div>
        <div className="mt-0.5 text-[11.5px] text-ink-3">{[p.departamento, p.grupo].filter(Boolean).join(' › ')}</div>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-ink-2">
          <span className="font-semibold tnum">{p.precio_venta > 0 ? fmtCop(p.precio_venta) : <Badge tone="warn">Sin precio</Badge>}</span>
          <span>Stock <b className="tnum">{fmtNum(p.stock_actual)}</b></span>
          <span>90 d: <b className="tnum">{fmtNum(p.unidades_90d)}</b> uds</span>
          <span>{p.dias_sin_venta == null ? 'Sin ventas' : p.dias_sin_venta === 0 ? 'Vendido hoy' : `Última venta hace ${p.dias_sin_venta} d`}</span>
        </div>
        {extra}
      </div>
    </li>
  )
}

interface TabProps { sel: Set<string>; toggle: (p: Producto) => void; addMany: (ps: Producto[]) => void }

/** «¿Cómo se calculó?»: el descuento sugerido paso a paso, con los valores reales del producto. */
function ComoSeCalculo({ c }: { c: CalculoDescuento }) {
  const pct = (v: number) => `${new Intl.NumberFormat('es-CO', { maximumFractionDigits: 2 }).format(v)} %`   // 2 decimales: la cuenta cuadra exacta
  return (
    <details className="group rounded-lg border border-line px-2.5 py-1.5 text-[12px] text-ink-2">
      <summary className="flex cursor-pointer list-none items-center gap-1.5 font-semibold text-brand marker:hidden">
        <Calculator size={13} />¿Cómo se calculó el {c.descuento_pct} %?
        <span className="font-normal text-ink-3 group-open:hidden">· ver el cálculo</span>
      </summary>
      <ol className="mt-2 list-decimal space-y-1.5 pl-5">
        <li><b className="text-ink">Margen actual.</b> Precio {fmtCop(c.precio)} − último costo {fmtCop(c.costo)} = {fmtCop(c.ganancia_antes)} de ganancia por unidad, que es el <b className="text-ink">{pct(c.margen_pct)}</b> del precio.</li>
        <li><b className="text-ink">Cuánto se puede ceder.</b> Hasta el {c.factor_pct} % de ese margen: {pct(c.margen_pct)} × {c.factor_pct} % = <b className="text-ink">{pct(c.posible_pct)}</b>. Así siempre se conserva al menos el {100 - c.factor_pct} % de la ganancia.</li>
        <li><b className="text-ink">Tope.</b> Nunca más del {c.tope_pct} %, para no devaluar el producto ante el cliente.
          {' '}{c.limitado_por_tope ? <>Como {pct(c.posible_pct)} supera el tope, se sugiere <b className="text-ink">{c.descuento_pct} %</b>.</> : <>Queda en <b className="text-ink">{c.descuento_pct} %</b> (redondeado).</>}</li>
        <li><b className="text-ink">Resultado.</b> {c.descuento_pct > 0
          ? <>Precio con descuento {fmtCop(c.precio_con_descuento)}: la ganancia por unidad pasa de {fmtCop(c.ganancia_antes)} a <b className="text-ink">{fmtCop(c.ganancia_despues)}</b> (margen {pct(c.margen_despues_pct)}).</>
          : <>Sin margen positivo sobre el último costo, no hay espacio para descontar sin vender a pérdida.</>}</li>
      </ol>
      <p className="mt-2 text-[11.5px] text-ink-3">Es un máximo referencial para mover el inventario: se puede ofrecer menos. Valídelo con compras (el costo es el de la última compra registrada en el ERP).</p>
    </details>
  )
}

// ------------------------------------------------------------------------------ pestaña 1: temporada + IA
interface RespTemporada {
  temporada: Temporada | null; fuente: 'ia' | 'reglas' | 'datos'; resumen: string; items: Producto[]; tokens: number; aviso?: string
  combos: { nombre: string; producto_ids: string[]; idea: string }[]; tiene_historial: boolean; pool: number
}

function TabTemporada({ sel, toggle, addMany, temporadaId, onTemporada }: TabProps & { temporadaId: string | null; onTemporada: (id: string | null) => void }) {
  const { data: t, error: et } = useGet<{ temporadas: Temporada[]; zona: string; hoy: string }>('/campanas/temporadas')
  const [res, setRes] = useState<RespTemporada | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<unknown>(null)
  const actual = temporadaId ?? t?.temporadas.find((x) => x.estado === 'en_curso')?.id ?? t?.temporadas[0]?.id ?? ''

  const generar = async () => {
    setBusy(true); setErr(null)
    try { setRes(await api<RespTemporada>('/campanas/ia/recomendar-temporada', { method: 'POST', body: { temporada_id: actual || null, limite: 12 } })); onTemporada(actual || null) }
    catch (e) { setErr(e) } finally { setBusy(false) }
  }
  const porId = useMemo(() => new Map((res?.items ?? []).map((p) => [p.producto_id, p])), [res])

  return (
    <div className="space-y-4">
      <Card title="Recomendación de la IA según la temporada" subtitle={t ? `Zona: ${t.zona}` : undefined}>
        {et ? <ErrorBox error={et} /> : !t ? <Skeleton h={80} /> : (
          <div className="space-y-3">
            <div className="flex flex-wrap items-end gap-3">
              <div className="min-w-60 flex-1">
                <Field label="Temporada o fecha especial">
                  <select value={actual} onChange={(e) => { onTemporada(e.target.value); setRes(null) }}
                    className="h-9 w-full rounded-lg border border-line-strong bg-surface px-2 text-[13px] text-ink outline-none focus:border-brand">
                    {t.temporadas.map((x) => <option key={x.id} value={x.id}>{x.nombre} — {x.estado === 'en_curso' ? 'en curso' : `en ${x.dias_para_inicio} días`} ({fmtFecha(x.inicio)})</option>)}
                  </select>
                </Field>
              </div>
              <Btn variant="accent" icon={busy ? undefined : <Sparkles size={15} />} busy={busy} onClick={() => void generar()}>{res ? 'Volver a generar' : 'Generar recomendación'}</Btn>
            </div>
            <p className="flex items-start gap-1.5 text-[11.5px] text-ink-3"><Info size={13} className="mt-px shrink-0" />
              Consume tokens de la IA. La IA solo elige entre productos que existen en su inventario, están activos y tienen stock; no inventa productos.</p>
          </div>
        )}
      </Card>

      {err != null && <ErrorBox error={err} onRetry={() => void generar()} />}
      {busy && <div className="space-y-2"><Skeleton h={70} /><Skeleton h={70} /><Skeleton h={70} /></div>}

      {res && !busy && (
        <Card pad={false} title={res.temporada ? res.temporada.nombre : 'Sin temporada'}
          subtitle={<span className="flex flex-wrap items-center gap-2">{res.fuente === 'ia' ? <Badge tone="brand"><Sparkles size={11} />Recomendado por IA</Badge> : <Badge>Por reglas de datos</Badge>}
            {res.tokens > 0 && <span>{fmtNum(res.tokens)} tokens</span>}</span>}
          actions={res.items.length > 0 ? <Btn small icon={<Plus size={14} />} onClick={() => addMany(res.items)}>Agregar todos ({res.items.length})</Btn> : undefined}>
          <div className="space-y-2 border-b border-line px-4 py-3">
            {res.resumen && <p className="text-[13px] leading-relaxed text-ink-2">{res.resumen}</p>}
            {res.aviso && <Notice tone="warn">{res.aviso} Se muestran sugerencias calculadas solo con datos.</Notice>}
            {!res.tiene_historial && <Notice tone="info" icon={<Info size={15} className="mt-0.5 shrink-0" />}>El ERP no tiene ventas de esta misma temporada en años anteriores: la sugerencia se basa en el calendario comercial y en la rotación de los últimos 90 días.</Notice>}
          </div>
          {res.items.length === 0 ? <Empty text="No hay productos del inventario que encajen con esta temporada" hint="Pruebe otra temporada o use la búsqueda manual." /> : (
            <ul className="divide-y divide-line">
              {res.items.map((p) => (
                <ProductoFila key={p.producto_id} p={p} checked={sel.has(p.producto_id)} onToggle={() => toggle(p)}
                  extra={p.razon ? <p className="mt-1.5 flex items-start gap-1.5 rounded-lg bg-surface-2 px-2.5 py-1.5 text-[12px] text-ink-2"><Sparkles size={12} className="mt-0.5 shrink-0 text-brand" />{p.razon}</p> : undefined} />
              ))}
            </ul>
          )}
          {res.combos.length > 0 && (
            <div className="border-t border-line px-4 py-3">
              <div className="mb-2 text-[12px] font-bold text-ink-2">Ideas de combo</div>
              <div className="grid gap-2 md:grid-cols-2">
                {res.combos.map((c) => {
                  const prods = c.producto_ids.map((id) => porId.get(id)).filter((x): x is Producto => !!x)
                  return (
                    <div key={c.nombre} className="rounded-xl border border-line p-3">
                      <div className="text-[13px] font-bold text-ink">{c.nombre}</div>
                      <p className="mt-0.5 text-[12px] text-ink-3">{c.idea}</p>
                      <div className="mt-1 text-[11.5px] text-ink-2">{prods.map((p) => p.producto).join(' + ')}</div>
                      {prods.length > 0 && <Btn small className="mt-2" icon={<Plus size={13} />} onClick={() => addMany(prods)}>Agregar combo</Btn>}
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </Card>
      )}
    </div>
  )
}

// ------------------------------------------------------------------------------ pestaña 2: inventario / rotación
const CAUSAS: Record<string, { label: string; tone: 'bad' | 'warn' }> = {
  sin_rotacion: { label: 'Sin rotación', tone: 'bad' }, sobrestock: { label: 'Sobrestock', tone: 'warn' }, baja_rotacion: { label: 'Baja rotación', tone: 'warn' },
}

function TabInventario({ sel, toggle, addMany }: TabProps) {
  const [items, setItems] = useState<Producto[] | null>(null)
  const [nota, setNota] = useState('')
  const [err, setErr] = useState<unknown>(null)
  const [limite, setLimite] = useState(20)
  const [cargando, setCargando] = useState(true)
  useEffect(() => {
    let vivo = true
    setCargando(true); setErr(null)
    api<{ items: Producto[]; nota: string }>(`/campanas/productos/recomendar-inventario?limite=${limite}`, { method: 'POST', body: {} })
      .then((r) => { if (vivo) { setItems(r.items); setNota(r.nota) } })
      .catch((e) => { if (vivo) setErr(e) })
      .finally(() => { if (vivo) setCargando(false) })
    return () => { vivo = false }
  }, [limite])
  const capital = (items ?? []).reduce((a, p) => a + (p.capital_inmovilizado ?? 0), 0)

  return (
    <Card pad={false} title="Productos con exceso de inventario o sin rotar" subtitle="Calculado con los datos reales de ventas y stock (no consume tokens)"
      actions={items && items.length > 0 ? <Btn small icon={<Plus size={14} />} onClick={() => addMany(items)}>Agregar todos ({items.length})</Btn> : undefined}>
      {err != null ? <div className="p-4"><ErrorBox error={err} /></div> : cargando ? <div className="space-y-2 p-4"><Skeleton h={70} /><Skeleton h={70} /><Skeleton h={70} /></div>
        : !items || items.length === 0 ? <Empty text="No se detectó inventario inmovilizado" hint="Ningún producto activo supera los umbrales de exceso o falta de rotación." /> : (
          <>
            <div className="flex flex-wrap items-center gap-x-5 gap-y-1 border-b border-line px-4 py-3 text-[12.5px] text-ink-2">
              <span>Capital inmovilizado en esta lista: <b className="text-ink">{fmtCop(capital)}</b></span>
              <label className="ml-auto flex items-center gap-2">Mostrar
                <select value={limite} onChange={(e) => setLimite(Number(e.target.value))} className="h-8 rounded-lg border border-line-strong bg-surface px-2 text-[12.5px]">
                  {[10, 20, 40, 80].map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </label>
            </div>
            <ul className="divide-y divide-line">
              {items.map((p) => (
                <ProductoFila key={p.producto_id} p={p} checked={sel.has(p.producto_id)} onToggle={() => toggle(p)}
                  extra={(
                    <div className="mt-1.5 space-y-1.5">
                      <div className="flex flex-wrap items-center gap-2">
                        {p.causa && <Badge tone={CAUSAS[p.causa]?.tone ?? 'warn'}>{CAUSAS[p.causa]?.label ?? p.causa}</Badge>}
                        <span className="text-[11.5px] text-ink-3">Capital inmovilizado <b className="text-ink-2">{fmtCop(p.capital_inmovilizado)}</b></span>
                        {(p.descuento_sugerido ?? 0) > 0 && <Badge tone="good" title="Descuento máximo referencial que conserva al menos 40 % del margen">Descuento sugerido hasta {p.descuento_sugerido}%</Badge>}
                        {(p.descuento_sugerido ?? 0) === 0 && <Badge title="El margen sobre el último costo no permite descontar">Sin margen para descuento</Badge>}
                      </div>
                      <p className="flex items-start gap-1.5 rounded-lg bg-surface-2 px-2.5 py-1.5 text-[12px] text-ink-2"><Boxes size={12} className="mt-0.5 shrink-0 text-warn" />{p.razon}</p>
                      {p.descuento_calculo && <ComoSeCalculo c={p.descuento_calculo} />}
                    </div>
                  )} />
              ))}
            </ul>
            <p className="border-t border-line px-4 py-2.5 text-[11.5px] text-ink-3">{nota}</p>
          </>
        )}
    </Card>
  )
}

// ------------------------------------------------------------------------------ pestaña 3: búsqueda manual
const ORDENES = [['venta_90d', 'Más vendidos (90 d)'], ['unidades_90d', 'Más unidades (90 d)'], ['dias_sin_venta', 'Más tiempo sin vender'], ['capital', 'Mayor capital en stock'], ['stock', 'Mayor stock'], ['precio', 'Mayor precio'], ['nombre', 'Nombre A-Z']]

function TabManual({ sel, toggle, addMany }: TabProps) {
  const { data: fo, error: ef } = useGet<Filtros>('/campanas/productos/filtros', { stale: 300_000 })
  const [q, setQ] = useState('')
  const [f, setF] = useState({ familias: [] as string[], departamentos: [] as string[], grupos: [] as string[], secciones: [] as string[], tipos: [] as string[], marcas: [] as string[] })
  const [solo, setSolo] = useState({ stock: false, ventas: false, activos: true })
  const [minDias, setMinDias] = useState('')
  const [orden, setOrden] = useState('venta_90d')
  const [items, setItems] = useState<Producto[]>([])
  const [total, setTotal] = useState(0)
  const [cargando, setCargando] = useState(true)
  const [err, setErr] = useState<unknown>(null)
  const req = useRef(0)
  const [qd, setQd] = useState('')
  useEffect(() => { const t = setTimeout(() => setQd(q), 350); return () => clearTimeout(t) }, [q])

  const body = useMemo(() => ({
    q: qd, ...f, solo_activos: solo.activos, solo_con_stock: solo.stock, solo_con_ventas: solo.ventas,
    min_dias_sin_venta: Number(minDias) > 0 ? Math.min(3650, Number(minDias)) : 0, orden, limite: 50,
  }), [qd, f, solo, minDias, orden])

  const cargar = useCallback(async (offset: number) => {
    const id = ++req.current
    setCargando(true); setErr(null)
    try {
      const r = await api<{ total: number; items: Producto[] }>('/campanas/productos/buscar', { method: 'POST', body: { ...body, offset } })
      if (id !== req.current) return
      setTotal(r.total); setItems((prev) => (offset ? [...prev, ...r.items] : r.items))
    } catch (e) { if (id === req.current) setErr(e) } finally { if (id === req.current) setCargando(false) }
  }, [body])
  useEffect(() => { void cargar(0) }, [cargar])

  // Los códigos del ERP son jerárquicos por prefijo: al elegir una familia solo se ofrecen sus departamentos, y así hacia abajo.
  const hijos = (op: Filtros['departamentos'], padres: string[]) => (padres.length ? op.filter((o) => padres.some((p) => o.codigo.startsWith(p))) : op)
  const deptos = useMemo(() => hijos(fo?.departamentos ?? [], f.familias), [fo, f.familias])
  const grupos = useMemo(() => hijos(fo?.grupos ?? [], f.departamentos.length ? f.departamentos : f.familias), [fo, f.departamentos, f.familias])
  const secciones = useMemo(() => hijos(fo?.secciones ?? [], f.grupos.length ? f.grupos : f.departamentos), [fo, f.grupos, f.departamentos])
  const nFiltros = Object.values(f).reduce((a, v) => a + v.length, 0) + (qd ? 1 : 0) + (solo.stock ? 1 : 0) + (solo.ventas ? 1 : 0) + (minDias ? 1 : 0)
  const limpiar = () => { setQ(''); setF({ familias: [], departamentos: [], grupos: [], secciones: [], tipos: [], marcas: [] }); setSolo({ stock: false, ventas: false, activos: true }); setMinDias('') }

  return (
    <div className="space-y-4">
      <Card title="Filtros" actions={nFiltros > 0 ? <Btn small variant="ghost" onClick={limpiar}>Limpiar ({nFiltros})</Btn> : undefined}>
        {ef ? <ErrorBox error={ef} /> : (
          <div className="space-y-3">
            <SearchInput value={q} onChange={setQ} placeholder="Buscar por nombre, código de barras o ID del producto…" />
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <MultiSelect label="Familia" options={fo?.familias ?? []} value={f.familias} onChange={(v) => setF({ ...f, familias: v, departamentos: [], grupos: [], secciones: [] })} />
              <MultiSelect label="Departamento" options={deptos} value={f.departamentos} onChange={(v) => setF({ ...f, departamentos: v, grupos: [], secciones: [] })} />
              <MultiSelect label="Grupo" options={grupos} value={f.grupos} onChange={(v) => setF({ ...f, grupos: v, secciones: [] })} />
              <MultiSelect label="Sección" options={secciones} value={f.secciones} onChange={(v) => setF({ ...f, secciones: v })} />
              <MultiSelect label="Tipo de producto" options={fo?.tipos ?? []} value={f.tipos} onChange={(v) => setF({ ...f, tipos: v })} />
              <MultiSelect label="Marca" options={fo?.marcas ?? []} value={f.marcas} onChange={(v) => setF({ ...f, marcas: v })} />
            </div>
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[12.5px] text-ink-2">
              <label className="flex items-center gap-1.5"><input type="checkbox" checked={solo.stock} onChange={(e) => setSolo({ ...solo, stock: e.target.checked })} /> Solo con stock</label>
              <label className="flex items-center gap-1.5"><input type="checkbox" checked={solo.ventas} onChange={(e) => setSolo({ ...solo, ventas: e.target.checked })} /> Con ventas en 90 días</label>
              <label className="flex items-center gap-1.5">Sin vender hace ≥
                <input value={minDias} inputMode="numeric" onChange={(e) => setMinDias(e.target.value.replace(/\D/g, '').slice(0, 4))} placeholder="días" className="h-8 w-20 rounded-lg border border-line-strong bg-surface px-2 text-[12.5px]" /> días</label>
              <label className="ml-auto flex items-center gap-2">Ordenar por
                <select value={orden} onChange={(e) => setOrden(e.target.value)} className="h-8 rounded-lg border border-line-strong bg-surface px-2 text-[12.5px]">
                  {ORDENES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </label>
            </div>
          </div>
        )}
      </Card>

      <Card pad={false} title={cargando && items.length === 0 ? 'Buscando…' : `${fmtNum(total)} producto(s)`}
        actions={items.length > 0 ? <Btn small icon={<Plus size={14} />} onClick={() => addMany(items)}>Agregar los {items.length} mostrados</Btn> : undefined}>
        {err != null ? <div className="p-4"><ErrorBox error={err} onRetry={() => void cargar(0)} /></div>
          : cargando && items.length === 0 ? <div className="space-y-2 p-4"><Skeleton h={64} /><Skeleton h={64} /><Skeleton h={64} /></div>
          : items.length === 0 ? <Empty text="Ningún producto coincide con los filtros" />
          : (
            <>
              <ul className={clsx('divide-y divide-line', cargando && 'is-fetching')}>
                {items.map((p) => <ProductoFila key={p.producto_id} p={p} checked={sel.has(p.producto_id)} onToggle={() => toggle(p)} />)}
              </ul>
              {items.length < total && (
                <div className="flex justify-center border-t border-line p-3">
                  <Btn busy={cargando} onClick={() => void cargar(items.length)}>Cargar más ({fmtNum(total - items.length)} restantes)</Btn>
                </div>
              )}
            </>
          )}
      </Card>
      {cargando && items.length > 0 && <div className="flex justify-center text-ink-3"><Spinner /></div>}
    </div>
  )
}
