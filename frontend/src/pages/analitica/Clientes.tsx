import { FilterX, SlidersHorizontal, Users } from 'lucide-react'
import { useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import EChart, { useChartTokens, type ChartClick } from '@/charts/EChart'
import { columnsOption, donutOption, embudoOption, filaTip, fmtV, heatmapOption, lineOption, piramideOption, rankingOption } from '@/charts/builders'
import { Btn, Notice } from '@/components/ui'
import { fmtCop, fmtFecha, fmtNum, fmtNum1, fmtPct } from '@/lib/format'
import { CICLOS, SEGMENTOS } from '../clientes/modelo'
import { ChartCard, consulta, Estado, FiltroActivo, FiltroMenu, Kpi, Seccion, useTablero, type OpcionFiltro } from './kit'

type N = number
interface Fila { id: string; n: N; venta?: N; visitas?: N; nombre?: string }
interface Club extends Fila { con_compras: N; activos_90: N; autorizan: N; contactables: N }
interface Tablero {
  corte: string; datos_desde: string | null; aviso: string | null
  poblacion: {
    kpis: Record<string, N | null>
    contacto: { embudo: { id: string; n: N }[]; consentimiento: { id: string; n: N }[]; canales: { id: string; si: N; no: N }[]; datos: Record<string, N> }
    estados: Record<string, N>
    altas: { mes: string; n: N }[]; segmentos: Fila[]; ciclos: Fila[]; recencia: Fila[]; frecuencia: Fila[]
    clubes: Club[]; n_clubes: { id: N; n: N }[]; pares_clubes: { a: string; b: string; n: N }[]; mascotas: (Fila & { clientes: N })[]
    demografia: { edad: string; sexo: string; n: N }[]; ciudades: Fila[]; sedes_alta: Fila[]; completitud: Fila[]
  }
  comportamiento: null | {
    mensual: { mes: string; clientes: N; nuevos: N | null; visitas: N; venta: N }[]
    calor: { dia: N; hora: N; v: N }[]; dia_pref: { id: N; n: N }[]; franja: { id: string; n: N }[]
    perfil: { items: N | null; intervalo: N | null; descuento: N | null; de_finde: N; n: N }[]
    descuento: Fila[]; categorias: Fila[]; departamentos: Fila[]
    marcas: { nombre: string; clientes: N; venta: N }[]; sedes: { id: N; nombre: string; clientes: N; venta: N; tickets: N }[]
  }
}
interface Opciones { clubes: { id: string; nombre: string; color: string; activa: boolean }[]; ciudades: { id: string; nombre: string; n: N }[] }

const FILTROS = ['clubes', 'segmentos', 'ciclos', 'sexos', 'edades', 'ciudades', 'consentimiento'] as const
type Filtros = Record<(typeof FILTROS)[number], string[]>
const EDADES = ['menor', '18-24', '25-34', '35-44', '45-54', '55-64', '65+', 'sin_dato']
const EDAD_LABEL: Record<string, string> = { menor: 'Menor de 18', sin_dato: 'Sin dato' }
const ORDEN = (orden: string[]) => (a: { id: string | N }, b: { id: string | N }) => orden.indexOf(String(a.id)) - orden.indexOf(String(b.id))
const DIAS = ['', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo']
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
const mes = (m: string) => { const [y, mm] = m.split('-'); return `${MESES[Number(mm) - 1] ?? mm} ${y.slice(2)}` }
const CONSENT: Record<string, string> = { si: 'Autoriza', no: 'No autoriza', sin_registro: 'Sin registro' }
// Número de compras (días con compra) por cliente. Solo la última barra queda abierta.
const FRECUENCIA = ['1-2', '3-5', '6-12', '13-24', '25-52', '53-100', '101+']

export default function AnaliticaClientes() {
  const t = useChartTokens()
  const [sp, setSp] = useSearchParams()
  const f = useMemo(() => Object.fromEntries(FILTROS.map((k) => [k, (sp.get(k) ?? '').split(',').filter(Boolean)])) as Filtros, [sp])
  const set = (k: keyof Filtros, v: string[]) => {
    const n = new URLSearchParams(sp)
    if (v.length) n.set(k, v.join(',')); else n.delete(k)
    setSp(n, { replace: true })
  }
  const alternar = (k: keyof Filtros, id: string) => set(k, f[k].includes(id) ? f[k].filter((x) => x !== id) : [...f[k], id])
  const activos = FILTROS.reduce((s, k) => s + f[k].length, 0)

  const op = useTablero<Opciones>('/analitica/clientes/opciones')
  const menus: { clave: keyof Filtros; label: string; opciones: OpcionFiltro[] }[] = useMemo(() => [
    { clave: 'clubes', label: 'Club', opciones: [...(op.data?.clubes ?? []).map((x) => ({ id: x.id, label: x.nombre, color: x.color })), { id: 'ninguno', label: 'Sin club', color: '#8A97A3' }] },
    { clave: 'segmentos', label: 'Segmento', opciones: Object.entries(SEGMENTOS).map(([id, label]) => ({ id, label })) },
    { clave: 'ciclos', label: 'Momento de compra', opciones: Object.entries(CICLOS).map(([id, label]) => ({ id, label })) },
    { clave: 'sexos', label: 'Sexo', opciones: [{ id: 'F', label: 'Mujeres' }, { id: 'M', label: 'Hombres' }, { id: 'N', label: 'Sin dato' }] },
    { clave: 'edades', label: 'Edad', opciones: EDADES.map((e) => ({ id: e, label: EDAD_LABEL[e] ?? e })) },
    { clave: 'ciudades', label: 'Ciudad', opciones: (op.data?.ciudades ?? []).map((x) => ({ id: x.id, label: `${x.nombre} (${fmtNum(x.n)})` })) },
    { clave: 'consentimiento', label: 'Consentimiento', opciones: Object.entries(CONSENT).map(([id, label]) => ({ id, label })) },
  ], [op.data])
  const q = useTablero<Tablero>(`/analitica/clientes${consulta(f)}`)
  const d = q.data
  const p = d?.poblacion
  const c = d?.comportamiento
  const k = p?.kpis ?? {}
  const cargando = q.isLoading
  const actualizando = q.isFetching && !q.isLoading

  const clubInfo = useMemo(() => new Map((op.data?.clubes ?? []).map((x) => [x.id, x])), [op.data])
  const nombreClub = (id: string) => (id === 'ninguno' ? 'Sin club' : clubInfo.get(id)?.nombre ?? `Club ${id}`)
  const colorClub = (id: string) => (id === 'ninguno' ? t.compare : clubInfo.get(id)?.color ?? t.series[0])

  // ------------------------------------------------------------------ opciones de gráficas
  const g = useMemo(() => {
    if (!p) return null
    // «Sin compras» (sin compras con documento en el periodo) se informa aparte: su barra aplastaría a los segmentos reales.
    const segs = p.segmentos.filter((s) => s.id !== 'sin_compras').sort((a, b) => b.n - a.n)
    // Rangos fijos en orden (los que no tengan clientes aparecen en 0 para que la escala se lea completa).
    const frecuencia = FRECUENCIA.map((id) => ({ id, n: p.frecuencia.find((x) => x.id === id)?.n ?? 0 }))
    // Gasto por compra de cada segmento = todo lo que compraron ÷ cuántas veces compraron (un solo monto por barra).
    const porCompra = segs.filter((s) => (s.visitas ?? 0) > 0).map((s) => ({ ...s, valor: (s.venta ?? 0) / s.visitas! })).sort((a, b) => b.valor - a.valor)
    const clubes = p.clubes.filter((x) => x.id !== 'ninguno').sort((a, b) => b.n - a.n)
    const sin = p.clubes.find((x) => x.id === 'ninguno')
    const comparar = [...clubes, ...(sin ? [sin] : [])]
    const dem = (sexo: string) => EDADES.filter((e) => e !== 'sin_dato').map((e) => p.demografia.find((x) => x.edad === e && x.sexo === sexo)?.n ?? 0)
    return {
      segmentos: rankingOption(t, {
        categories: segs.map((s) => SEGMENTOS[s.id] ?? s.id), values: segs.map((s) => s.n), fmt: 'int',
        extra: (i) => filaTip(t.compare, 'Venta histórica', fmtV(segs[i].venta ?? 0, 'money', false)) + filaTip(t.compare, 'Ticket promedio', fmtV(segs[i].visitas ? (segs[i].venta ?? 0) / segs[i].visitas! : null, 'money', false)),
      }),
      ciclos: donutOption(t, { fmt: 'int', items: [...p.ciclos].sort(ORDEN(Object.keys(CICLOS))).map((x) => ({ name: CICLOS[x.id] ?? x.id, value: x.n })) }),
      recencia: columnsOption(t, { fmt: 'int', labels: [...p.recencia].sort(ORDEN(['0-30', '31-60', '61-90', '91-180', '181+'])).map((x) => `${x.id} días`),
        series: [{ name: 'Clientes', color: t.series[0], data: [...p.recencia].sort(ORDEN(['0-30', '31-60', '61-90', '91-180', '181+'])).map((x) => x.n) }] }),
      frecuencia: columnsOption(t, { fmt: 'int', ejeX: 'Número de compras en el periodo', labels: frecuencia.map((x) => x.id),
        series: [{ name: 'Clientes', color: t.series[2], data: frecuencia.map((x) => x.n) }] }),
      porCompra: rankingOption(t, {
        fmt: 'money', margenIzq: 16, categories: porCompra.map((s) => SEGMENTOS[s.id] ?? s.id), values: porCompra.map((s) => s.valor), colors: porCompra.map(() => t.series[3]),
        extra: (i) => filaTip(t.compare, 'Clientes', fmtV(porCompra[i].n, 'int', false)) + filaTip(t.compare, 'Compras', fmtV(porCompra[i].visitas ?? 0, 'int', false)),
      }),
      clubes: rankingOption(t, {
        categories: clubes.map((x) => nombreClub(x.id)), values: clubes.map((x) => x.n), fmt: 'int', colors: clubes.map((x) => colorClub(x.id)),
        extra: (i) => filaTip(t.compare, 'Con compras', fmtV(clubes[i].con_compras, 'int', false)) + filaTip(t.compare, 'Activos (90 días)', fmtV(clubes[i].activos_90, 'int', false)) + filaTip(t.compare, 'Contactables', fmtV(clubes[i].contactables, 'int', false)),
      }),
      ticketClub: rankingOption(t, { categories: comparar.map((x) => nombreClub(x.id)), colors: comparar.map((x) => colorClub(x.id)), fmt: 'money',
        values: comparar.map((x) => (x.visitas ? (x.venta ?? 0) / x.visitas : null)) }),
      actividadClub: columnsOption(t, { fmt: 'pct', labels: comparar.map((x) => nombreClub(x.id)), series: [
        { name: '% activos (90 días)', color: t.series[0], data: comparar.map((x) => (x.n ? (100 * x.activos_90) / x.n : null)) },
        { name: '% contactables', color: t.series[1], data: comparar.map((x) => (x.n ? (100 * x.contactables) / x.n : null)) },
      ] }),
      nClubes: donutOption(t, { fmt: 'int', items: p.n_clubes.map((x) => ({ name: x.id === 0 ? 'Ningún club' : x.id >= 4 ? '4 o más clubes' : `${x.id} club${x.id > 1 ? 'es' : ''}`, value: x.n, color: x.id === 0 ? t.compare : undefined })) }),
      mascotas: donutOption(t, { fmt: 'int', items: p.mascotas.map((x) => ({ name: x.nombre ?? x.id, value: x.n })) }),
      piramide: piramideOption(t, { bandas: EDADES.filter((e) => e !== 'sin_dato').map((e) => EDAD_LABEL[e] ?? e), mujeres: dem('F'), hombres: dem('M') }),
      ciudades: rankingOption(t, { categories: p.ciudades.map((x) => x.nombre ?? x.id), values: p.ciudades.map((x) => x.n), fmt: 'int',
        extra: (i) => filaTip(t.compare, 'Venta histórica', fmtV(p.ciudades[i].venta ?? 0, 'money', false)) }),
      sedesAlta: rankingOption(t, { categories: p.sedes_alta.map((x) => x.nombre ?? x.id), values: p.sedes_alta.map((x) => x.n), fmt: 'int', colors: p.sedes_alta.map(() => t.series[3]) }),
      embudo: embudoOption(t, { etapas: [
        { nombre: 'Clientes', n: p.contacto.embudo[0].n, color: t.series[0] },
        { nombre: 'Con celular o correo válido', n: p.contacto.embudo[1].n, color: t.series[3], ayuda: 'Tienen al menos un canal por donde se les puede escribir.' },
        { nombre: 'Y autorizan el tratamiento', n: p.contacto.embudo[2].n, color: t.series[2], ayuda: 'Ley 1581: solo se contacta a quien dio su autorización.' },
        { nombre: 'Contactables', n: p.contacto.embudo[3].n, color: t.series[1], ayuda: 'Además no tienen BLOQUE en el ERP (no enviar campañas): a ellos sí se les puede enviar campañas.' },
      ] }),
      consentimiento: donutOption(t, { fmt: 'int', items: p.contacto.consentimiento.map((x) => ({ name: CONSENT[x.id], value: x.n, color: x.id === 'si' ? t.series[1] : x.id === 'no' ? t.neg : t.compare })) }),
      canales: columnsOption(t, { fmt: 'int', stacked: true, horizontal: true, labels: ['WhatsApp', 'SMS', 'Correo'], series: [
        { name: 'Autoriza', color: t.series[1], data: p.contacto.canales.map((x) => x.si) },
        { name: 'No autoriza', color: t.neg, data: p.contacto.canales.map((x) => x.no) },
      ] }),
      completitud: columnsOption(t, { fmt: 'int', labels: [...p.completitud].sort(ORDEN(['0-39', '40-59', '60-79', '80-100'])).map((x) => `${x.id}%`),
        series: [{ name: 'Clientes', color: t.series[4], data: [...p.completitud].sort(ORDEN(['0-39', '40-59', '60-79', '80-100'])).map((x) => x.n) }] }),
      altas: lineOption(t, { fmt: 'int', labels: p.altas.map((x) => mes(x.mes)), series: [{ name: 'Fichas nuevas', color: t.series[2], data: p.altas.map((x) => x.n), area: true }] }),
    }
  }, [p, t, clubInfo]) // eslint-disable-line react-hooks/exhaustive-deps

  const gc = useMemo(() => {
    if (!c) return null
    const m = c.mensual
    return {
      activos: columnsOption(t, { fmt: 'int', stacked: true, labels: m.map((x) => mes(x.mes)), series: [
        { name: 'Recurrentes', color: t.series[0], data: m.map((x) => (x.nuevos == null ? x.clientes : x.clientes - x.nuevos)) },
        { name: 'Nuevos (primera compra)', color: t.series[1], data: m.map((x) => x.nuevos) },
      ] }),
      venta: lineOption(t, { fmt: 'money', labels: m.map((x) => mes(x.mes)), series: [{ name: 'Venta de los clientes', color: t.series[0], data: m.map((x) => x.venta), area: true }] }),
      ticket: lineOption(t, { fmt: 'money', labels: m.map((x) => mes(x.mes)), series: [{ name: 'Gasto promedio por visita', color: t.series[4], data: m.map((x) => (x.visitas ? x.venta / x.visitas : null)) }] }),
      calor: heatmapOption(t, { rows: c.calor, nombre: 'Visitas' }),
      dia: columnsOption(t, { fmt: 'int', labels: c.dia_pref.map((x) => DIAS[x.id]?.slice(0, 3) ?? String(x.id)), series: [{ name: 'Clientes', color: t.series[0], data: c.dia_pref.map((x) => x.n) }] }),
      franja: donutOption(t, { fmt: 'int', items: [...c.franja].sort(ORDEN(['mañana', 'tarde', 'noche'])).map((x) => ({ name: x.id[0].toUpperCase() + x.id.slice(1), value: x.n })) }),
      categorias: rankingOption(t, { categories: c.categorias.map((x) => x.nombre ?? x.id), values: c.categorias.map((x) => x.venta ?? 0), fmt: 'money',
        extra: (i) => filaTip(t.compare, 'Clientes que la compran', fmtV(c.categorias[i].n ?? (c.categorias[i] as unknown as { clientes: N }).clientes, 'int', false)) }),
      departamentos: donutOption(t, { fmt: 'money', items: c.departamentos.map((x) => ({ name: x.nombre ?? x.id, value: x.venta ?? 0 })) }),
      marcas: rankingOption(t, { categories: c.marcas.map((x) => x.nombre), values: c.marcas.map((x) => x.clientes), fmt: 'int', colors: c.marcas.map(() => t.series[2]),
        extra: (i) => filaTip(t.compare, 'Venta', fmtV(c.marcas[i].venta, 'money', false)) }),
      sedes: rankingOption(t, { categories: c.sedes.map((x) => x.nombre), values: c.sedes.map((x) => x.clientes), fmt: 'int', colors: c.sedes.map(() => t.series[4]),
        extra: (i) => filaTip(t.compare, 'Venta', fmtV(c.sedes[i].venta, 'money', false)) + filaTip(t.compare, 'Visitas (tickets)', fmtV(c.sedes[i].tickets, 'int', false)) }),
      descuento: donutOption(t, { fmt: 'int', items: [...c.descuento].sort(ORDEN(['Sin descuento', 'Menos de 5%', '5-15%', '15-30%', '30% o más'])).map((x) => ({ name: x.id, value: x.n })) }),
    }
  }, [c, t])

  const clicFiltro = (clave: keyof Filtros, ids: string[]) => (e: ChartClick) => { if (e.dataIndex != null && ids[e.dataIndex] != null) alternar(clave, ids[e.dataIndex]) }
  const segsOrden = p ? p.segmentos.filter((s) => s.id !== 'sin_compras').sort((a, b) => b.n - a.n).map((s) => s.id) : []
  const sinCompras = p?.segmentos.find((s) => s.id === 'sin_compras')?.n ?? 0
  const clubesOrden = p ? p.clubes.filter((x) => x.id !== 'ninguno').sort((a, b) => b.n - a.n).map((x) => x.id) : []
  const perfil = c?.perfil[0]
  const altura = (n: number) => Math.max(160, n * 28 + 30)

  return (
    <div className="mx-auto max-w-[1400px] space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-[24px] font-semibold text-ink"><Users size={22} className="text-brand" />Analítica de clientes</h1>
          <p className="text-[13px] text-ink-3">Quiénes son, cuántos hay en cada club, cómo compran y qué tan contactables son. Solo cifras agregadas: no se muestran datos personales.</p>
        </div>
        {d && <span className="rounded-full bg-surface-2 px-3 py-1 text-[12px] text-ink-3">Fichas al día · compras hasta <b className="text-ink">{fmtFecha(d.corte)}</b>{actualizando && ' · actualizando…'}</span>}
      </div>

      <section className="card px-3 py-2.5" aria-label="Filtros">
        <div className="flex flex-wrap items-center gap-2">
          <span className="mr-1 inline-flex items-center gap-1.5 pl-1 text-[12.5px] font-semibold text-ink-3"><SlidersHorizontal size={15} />Filtrar</span>
          {menus.map((m) => <FiltroMenu key={m.clave} label={m.label} opciones={m.opciones} valor={f[m.clave]} onChange={(v) => set(m.clave, v)} />)}
          {activos > 0 && <Btn small variant="ghost" className="ml-auto" icon={<FilterX size={14} />} onClick={() => setSp(new URLSearchParams(), { replace: true })}>Limpiar todo</Btn>}
        </div>
        {activos > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5 border-t border-line pt-2">
            {menus.flatMap((m) => f[m.clave].map((id) => {
              const o = m.opciones.find((x) => x.id === id)
              return <FiltroActivo key={`${m.clave}-${id}`} texto={`${m.label}: ${o?.label ?? id}`} color={o?.color} onQuitar={() => alternar(m.clave, id)} />
            }))}
          </div>
        )}
      </section>

      {cargando && q.failureCount > 0 && <Notice tone="info">Cargando la lista de clientes del ERP (la primera vez tarda unos segundos)…</Notice>}
      <Estado error={q.error} cargando={q.isFetching}>
        {d?.aviso && <Notice tone="info">{d.aviso}</Notice>}
        {q.error == null && !cargando && p && k.total === 0 && <Notice tone="info">Ningún cliente cumple los filtros elegidos.</Notice>}

        <Seccion titulo="Resumen">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {cargando ? Array.from({ length: 10 }, (_, i) => <div key={i} className="skeleton h-[98px] rounded-2xl" />) : <>
              <Kpi label="Clientes" value={fmtNum(k.total)} sub={`${fmtNum(k.altas_30)} fichas nuevas en 30 días`} />
              <Kpi label="Con compras registradas" value={fmtNum(k.con_compras)} sub={`${fmtPct(k.pct_con_compras)} de los clientes`} pct={k.pct_con_compras} />
              <Kpi label="Activos (compraron en 90 días)" value={fmtNum(k.activos_90)} sub={`${fmtPct(k.pct_activos_90)} de quienes compran`} pct={k.pct_activos_90} tone="good" />
              <Kpi label="Autorizan sus datos" value={fmtNum(k.autorizan)} sub={`${fmtPct(k.pct_autorizan)} · Ley 1581`} pct={k.pct_autorizan} tone="mint" />
              <Kpi label="Contactables para campañas" value={fmtNum(k.contactables)} sub={`${fmtPct(k.pct_contactables)} · autorizan, sin BLOQUE y con canal`} pct={k.pct_contactables} tone="mint" />
              <Kpi label="En algún club" value={fmtNum(k.en_clubes)} sub={`${fmtPct(k.pct_en_clubes)} de los clientes`} pct={k.pct_en_clubes} />
              <Kpi label="Ticket promedio" value={fmtCop(k.ticket)} sub="Gasto por visita" />
              <Kpi label="Venta de estos clientes" value={fmtCop(k.venta)} sub={`${fmtCop(k.venta_prom)} por cliente con compras`} />
              <Kpi label="Visitas por cliente" value={fmtNum1(k.visitas_prom)} sub={`Edad promedio ${fmtNum1(k.edad_prom)} años`} />
              <Kpi label="Ficha completa (promedio)" value={fmtPct(k.completitud)} sub={`${fmtPct(k.pct_con_edad)} tienen fecha de nacimiento`} pct={k.completitud} tone={(k.completitud ?? 0) >= 70 ? 'good' : 'warn'} />
            </>}
          </div>
        </Seccion>

        <Seccion titulo="Actividad en el tiempo">
          <div className="grid gap-4 lg:grid-cols-2">
            <ChartCard title="Clientes que compraron cada mes" subtitle="Nuevos (primera compra registrada) y recurrentes" cargando={cargando} height={280}
              info="Clientes distintos con al menos una compra en el mes. «Nuevos» = su primera compra con documento cae en ese mes; el primer mes de los datos no se puede separar (no hay historia previa)."
              table={c ? { cols: [{ key: 'mes', label: 'Mes' }, { key: 'clientes', label: 'Clientes', fmt: 'int' }, { key: 'nuevos', label: 'Nuevos', fmt: 'int' }, { key: 'visitas', label: 'Visitas', fmt: 'int' }, { key: 'venta', label: 'Venta', fmt: 'money' }], rows: c.mensual } : undefined}>
              {gc ? <EChart label="Clientes por mes" option={gc.activos} height={280} /> : <SinVentas />}
            </ChartCard>
            <ChartCard title="Fichas nuevas por mes" subtitle="Clientes registrados en el ERP (últimos 24 meses)" cargando={cargando} height={280}
              table={p ? { cols: [{ key: 'mes', label: 'Mes' }, { key: 'n', label: 'Fichas nuevas', fmt: 'int' }], rows: p.altas } : undefined}>
              {g && <EChart label="Fichas nuevas por mes" option={g.altas} height={280} />}
            </ChartCard>
            <ChartCard title="Venta mensual de estos clientes" cargando={cargando} height={240}>
              {gc ? <EChart label="Venta mensual" option={gc.venta} height={240} /> : <SinVentas />}
            </ChartCard>
            <ChartCard title="Gasto promedio por visita" subtitle="Venta del mes ÷ visitas del mes" cargando={cargando} height={240}>
              {gc ? <EChart label="Gasto promedio por visita" option={gc.ticket} height={240} /> : <SinVentas />}
            </ChartCard>
          </div>
        </Seccion>

        <Seccion titulo="Valor y fidelidad">
          <div className="grid gap-4 lg:grid-cols-3">
            <ChartCard className="lg:col-span-2" title="Clientes por segmento" subtitle={`Clientes con compras · clic en una barra para filtrar · además ${fmtNum(sinCompras)} sin compras registradas`} cargando={cargando} height={altura(segsOrden.length || 8)}
              info="Campeones: compran seguido, hace poco y gastan mucho. No se pueden perder: gastaban mucho pero se están alejando. Sin compras: no tienen compras registradas con documento en el periodo de datos."
              table={p ? { cols: [{ key: 'nombre', label: 'Segmento' }, { key: 'n', label: 'Clientes', fmt: 'int' }, { key: 'venta', label: 'Venta', fmt: 'money' }, { key: 'visitas', label: 'Visitas', fmt: 'int' }], rows: p.segmentos.map((s) => ({ ...s, nombre: SEGMENTOS[s.id] ?? s.id })) } : undefined}>
              {g && <EChart label="Clientes por segmento" option={g.segmentos} height={altura(segsOrden.length)} onClick={clicFiltro('segmentos', segsOrden)} />}
            </ChartCard>
            <ChartCard title="Momento de compra" subtitle="Según su ritmo habitual de recompra" cargando={cargando} height={260}
              info="Compara los días sin comprar con el intervalo habitual de cada cliente: «en su ventana» = es el momento natural para ofrecerle algo."
              table={p ? { cols: [{ key: 'nombre', label: 'Momento' }, { key: 'n', label: 'Clientes', fmt: 'int' }], rows: p.ciclos.map((x) => ({ ...x, nombre: CICLOS[x.id] ?? x.id })) } : undefined}>
              {g && <EChart label="Momento de compra" option={g.ciclos} height={260} />}
            </ChartCard>
            <ChartCard title="¿Hace cuánto compraron?" subtitle="Días desde la última compra (al corte)" cargando={cargando} height={220}
              table={p ? { cols: [{ key: 'id', label: 'Días' }, { key: 'n', label: 'Clientes', fmt: 'int' }, { key: 'venta', label: 'Venta', fmt: 'money' }], rows: p.recencia } : undefined}>
              {g && <EChart label="Recencia" option={g.recencia} height={220} />}
            </ChartCard>
            <ChartCard title="¿Cuántas veces compran?" subtitle="Clientes según cuántas veces han comprado" cargando={cargando} height={220}
              info="Cada barra cuenta los clientes que compraron ese número de veces en el periodo de datos (cada día con compra es una vez). Como guía para un año: 6-12 ≈ una vez al mes, 13-24 ≈ cada quince días, 25-52 ≈ cada semana."
              table={p ? { cols: [{ key: 'id', label: 'Veces que compró' }, { key: 'n', label: 'Clientes', fmt: 'int' }, { key: 'venta', label: 'Venta', fmt: 'money' }], rows: p.frecuencia } : undefined}>
              {g && <EChart label="Frecuencia" option={g.frecuencia} height={220} />}
            </ChartCard>
            <ChartCard title="¿Cuánto gasta cada tipo de cliente?" subtitle="Promedio por compra, en pesos" cargando={cargando} height={220}
              table={p ? { cols: [{ key: 'nombre', label: 'Segmento' }, { key: 'por_compra', label: 'Gasto por compra', fmt: 'money' }, { key: 'n', label: 'Clientes', fmt: 'int' }, { key: 'visitas', label: 'Compras', fmt: 'int' }],
                rows: p.segmentos.filter((s) => s.id !== 'sin_compras' && (s.visitas ?? 0) > 0).map((s) => ({ ...s, nombre: SEGMENTOS[s.id] ?? s.id, por_compra: (s.venta ?? 0) / s.visitas! })) } : undefined}>
              {g && <EChart label="Gasto por compra según tipo de cliente" option={g.porCompra} height={220} />}
            </ChartCard>
          </div>
        </Seccion>

        <Seccion titulo="Clubes y afiliaciones">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {!cargando && <>
              <Kpi label="Clientes en algún club" value={fmtNum(k.en_clubes)} sub={fmtPct(k.pct_en_clubes)} pct={k.pct_en_clubes} />
              <Kpi label="En 2 o más clubes" value={fmtNum(p?.n_clubes.filter((x) => x.id >= 2).reduce((s, x) => s + x.n, 0))} sub="Socios de varios clubes" />
              <Kpi label="Clientes con mascota" value={fmtNum(k.con_mascotas)} sub={`${fmtNum(k.mascotas)} mascotas registradas`} />
              <Kpi label="Clientes con vehículo" value={fmtNum(k.con_vehiculos)} sub={`${fmtNum(k.vehiculos)} vehículos registrados`} />
            </>}
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <ChartCard title="Socios por club" subtitle="Clic en una barra para ver solo ese club" cargando={cargando} height={altura(clubesOrden.length || 5)}
              table={p ? { cols: [{ key: 'nombre', label: 'Club' }, { key: 'n', label: 'Socios', fmt: 'int' }, { key: 'con_compras', label: 'Con compras', fmt: 'int' }, { key: 'activos_90', label: 'Activos 90 d', fmt: 'int' }, { key: 'autorizan', label: 'Autorizan', fmt: 'int' }, { key: 'contactables', label: 'Contactables', fmt: 'int' }, { key: 'venta', label: 'Venta', fmt: 'money' }],
                rows: p.clubes.map((x) => ({ ...x, nombre: nombreClub(x.id) })) } : undefined}>
              {g && (clubesOrden.length ? <EChart label="Socios por club" option={g.clubes} height={altura(clubesOrden.length)} onClick={clicFiltro('clubes', clubesOrden)} /> : <Vacio texto="Ningún cliente de la selección está en un club." />)}
            </ChartCard>
            <ChartCard title="Gasto por visita: socios vs no socios" subtitle="Ticket promedio de los socios de cada club y de quienes no están en ninguno" cargando={cargando} height={altura((clubesOrden.length || 5) + 1)}>
              {g && <EChart label="Ticket por club" option={g.ticketClub} height={altura(clubesOrden.length + 1)} />}
            </ChartCard>
            <ChartCard title="Actividad y contactabilidad por club" subtitle="% de socios que compraron en 90 días y % que se pueden contactar" cargando={cargando} height={280}>
              {g && <EChart label="Actividad por club" option={g.actividadClub} height={280} />}
            </ChartCard>
            <div className="grid gap-4 sm:grid-cols-2">
              <ChartCard title="¿En cuántos clubes están?" cargando={cargando} height={250}
                table={p ? { cols: [{ key: 'id', label: 'Clubes' }, { key: 'n', label: 'Clientes', fmt: 'int' }], rows: p.n_clubes } : undefined}>
                {g && <EChart label="Número de clubes" option={g.nClubes} height={250} />}
              </ChartCard>
              <ChartCard title="Mascotas por tipo" subtitle="Registradas en el CRM" cargando={cargando} height={250}
                table={p ? { cols: [{ key: 'nombre', label: 'Tipo' }, { key: 'n', label: 'Mascotas', fmt: 'int' }, { key: 'clientes', label: 'Clientes', fmt: 'int' }], rows: p.mascotas } : undefined}>
                {g && (p!.mascotas.length ? <EChart label="Mascotas por tipo" option={g.mascotas} height={250} /> : <Vacio texto="Sin mascotas registradas." />)}
              </ChartCard>
            </div>
            {p && p.pares_clubes.length > 0 && (
              <ChartCard className="lg:col-span-2" title="Clubes que comparten socios" subtitle="Cuántas personas están a la vez en ambos clubes: oportunidades de beneficios cruzados" height={120}
                table={{ cols: [{ key: 'a', label: 'Club' }, { key: 'b', label: 'Y club' }, { key: 'n', label: 'Socios en ambos', fmt: 'int' }], rows: p.pares_clubes.map((x) => ({ a: nombreClub(x.a), b: nombreClub(x.b), n: x.n })) }}>
                <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {p.pares_clubes.slice(0, 9).map((x) => (
                    <li key={`${x.a}-${x.b}`} className="flex items-center gap-2 rounded-xl border border-line px-3 py-2 text-[12.5px]">
                      <span className="h-2.5 w-2.5 rounded-full" style={{ background: colorClub(x.a) }} /><span className="truncate">{nombreClub(x.a)}</span>
                      <span className="text-ink-3">+</span>
                      <span className="h-2.5 w-2.5 rounded-full" style={{ background: colorClub(x.b) }} /><span className="truncate">{nombreClub(x.b)}</span>
                      <b className="ml-auto text-ink tnum">{fmtNum(x.n)}</b>
                    </li>
                  ))}
                </ul>
              </ChartCard>
            )}
          </div>
        </Seccion>

        <Seccion titulo="Quiénes son y dónde están">
          <div className="grid gap-4 lg:grid-cols-3">
            <ChartCard title="Pirámide de edad" subtitle={`Mujeres y hombres por rango de edad · ${fmtPct(k.pct_con_edad)} tiene fecha de nacimiento`} cargando={cargando} height={300}
              table={p ? { cols: [{ key: 'edad', label: 'Edad' }, { key: 'sexo', label: 'Sexo' }, { key: 'n', label: 'Clientes', fmt: 'int' }], rows: p.demografia } : undefined}>
              {g && <EChart label="Pirámide de edad" option={g.piramide} height={300} />}
            </ChartCard>
            <ChartCard title="Ciudades" subtitle="Clic en una barra para filtrar" cargando={cargando} height={altura(p?.ciudades.length ?? 10)}
              table={p ? { cols: [{ key: 'nombre', label: 'Ciudad' }, { key: 'n', label: 'Clientes', fmt: 'int' }, { key: 'venta', label: 'Venta', fmt: 'money' }], rows: p.ciudades } : undefined}>
              {g && <EChart label="Clientes por ciudad" option={g.ciudades} height={altura(p!.ciudades.length)} onClick={clicFiltro('ciudades', p!.ciudades.map((x) => x.id).filter(Boolean))} />}
            </ChartCard>
            <ChartCard title="Sede donde se registraron" subtitle="Tienda en la que se creó la ficha" cargando={cargando} height={altura(p?.sedes_alta.length ?? 10)}
              table={p ? { cols: [{ key: 'nombre', label: 'Sede' }, { key: 'n', label: 'Clientes', fmt: 'int' }], rows: p.sedes_alta } : undefined}>
              {g && <EChart label="Sede de registro" option={g.sedesAlta} height={altura(p!.sedes_alta.length)} />}
            </ChartCard>
          </div>
        </Seccion>

        <Seccion titulo="Cómo compran">
          {c && perfil && (
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Kpi label="Productos distintos por visita" value={fmtNum1(perfil.items)} sub="Promedio por cliente" />
              <Kpi label="Días entre compras" value={fmtNum1(perfil.intervalo)} sub="Intervalo habitual promedio" />
              <Kpi label="Descuento sobre lo que compran" value={fmtPct(perfil.descuento != null ? perfil.descuento * 100 : null)} sub="Promedio por cliente" />
              <Kpi label="Compran sobre todo el fin de semana" value={fmtNum(perfil.de_finde)} sub={fmtPct(perfil.n ? (100 * perfil.de_finde) / perfil.n : null)} pct={perfil.n ? (100 * perfil.de_finde) / perfil.n : null} />
            </div>
          )}
          <div className="grid gap-4 lg:grid-cols-3">
            <ChartCard className="lg:col-span-2" title="¿Cuándo compran?" subtitle="Visitas por día de la semana y hora de llegada" cargando={cargando} height={300}
              info="Cada celda cuenta los días-cliente con compra según la primera hora de compra del día. Rojo = horas pico: ideal para programar los mensajes un poco antes.">
              {gc ? <EChart label="Mapa de calor día y hora" option={gc.calor} height={300} /> : <SinVentas />}
            </ChartCard>
            <div className="grid gap-4">
              <ChartCard title="Día preferido" subtitle="Día en que más compra cada cliente" cargando={cargando} height={130}>
                {gc ? <EChart label="Día preferido" option={gc.dia} height={130} /> : <SinVentas />}
              </ChartCard>
              <ChartCard title="Franja preferida" cargando={cargando} height={130}>
                {gc ? <EChart label="Franja preferida" option={gc.franja} height={130} /> : <SinVentas />}
              </ChartCard>
            </div>
            <ChartCard className="lg:col-span-2" title="Categorías que más compran" subtitle="Venta por grupo de productos" cargando={cargando} height={altura(c?.categorias.length ?? 12)}
              table={c ? { cols: [{ key: 'nombre', label: 'Categoría' }, { key: 'venta', label: 'Venta', fmt: 'money' }, { key: 'clientes', label: 'Clientes', fmt: 'int' }], rows: c.categorias } : undefined}>
              {gc ? <EChart label="Categorías" option={gc.categorias} height={altura(c!.categorias.length)} /> : <SinVentas />}
            </ChartCard>
            <ChartCard title="Departamentos" subtitle={c ? `Participación en la venta · total ${fmtCop(c.departamentos.reduce((s, x) => s + (x.venta ?? 0), 0))}` : "Participación en la venta"} cargando={cargando} height={280}
              table={c ? { cols: [{ key: 'nombre', label: 'Departamento' }, { key: 'venta', label: 'Venta', fmt: 'money' }, { key: 'clientes', label: 'Clientes', fmt: 'int' }], rows: c.departamentos } : undefined}>
              {gc ? <EChart label="Departamentos" option={gc.departamentos} height={280} /> : <SinVentas />}
            </ChartCard>
            <ChartCard title="Marcas con más clientes" subtitle="Clientes distintos que las compran" cargando={cargando} height={altura(c?.marcas.length ?? 12)}
              table={c ? { cols: [{ key: 'nombre', label: 'Marca' }, { key: 'clientes', label: 'Clientes', fmt: 'int' }, { key: 'venta', label: 'Venta', fmt: 'money' }], rows: c.marcas } : undefined}>
              {gc ? <EChart label="Marcas" option={gc.marcas} height={altura(c!.marcas.length)} /> : <SinVentas />}
            </ChartCard>
            <ChartCard title="Sedes donde compran" subtitle="Clientes distintos por sede" cargando={cargando} height={altura(c?.sedes.length ?? 10)}
              table={c ? { cols: [{ key: 'nombre', label: 'Sede' }, { key: 'clientes', label: 'Clientes', fmt: 'int' }, { key: 'tickets', label: 'Visitas', fmt: 'int' }, { key: 'venta', label: 'Venta', fmt: 'money' }], rows: c.sedes } : undefined}>
              {gc ? <EChart label="Sedes" option={gc.sedes} height={altura(c!.sedes.length)} /> : <SinVentas />}
            </ChartCard>
            <ChartCard title="Sensibilidad al descuento" subtitle="Qué parte de su compra fue con descuento" cargando={cargando} height={260}
              table={c ? { cols: [{ key: 'id', label: 'Descuento' }, { key: 'n', label: 'Clientes', fmt: 'int' }], rows: c.descuento } : undefined}>
              {gc ? <EChart label="Sensibilidad al descuento" option={gc.descuento} height={260} /> : <SinVentas />}
            </ChartCard>
          </div>
        </Seccion>

        <Seccion titulo="Contactabilidad y calidad de datos">
          <div className="grid gap-4 lg:grid-cols-2">
            <ChartCard title="De clientes a contactables" subtitle="Cada etapa descuenta a quien no cumple" cargando={cargando} height={200}
              table={p ? { cols: [{ key: 'id', label: 'Etapa' }, { key: 'n', label: 'Clientes', fmt: 'int' }], rows: p.contacto.embudo } : undefined}>
              {g && <EChart label="Embudo de contactabilidad" option={g.embudo} height={200} />}
            </ChartCard>
            <ChartCard title="Autorización de datos" subtitle={`${fmtNum(p?.contacto.datos.bloque)} tienen BLOQUE (no enviar campañas) en el ERP`} cargando={cargando} height={200}
              table={p ? { cols: [{ key: 'nombre', label: 'Consentimiento' }, { key: 'n', label: 'Clientes', fmt: 'int' }], rows: p.contacto.consentimiento.map((x) => ({ ...x, nombre: CONSENT[x.id] })) } : undefined}>
              {g && <EChart label="Consentimiento" option={g.consentimiento} height={200} />}
            </ChartCard>
            <ChartCard title="Canales autorizados" subtitle="Autorización por canal registrada en el ERP (el resto no tiene registro)" cargando={cargando} height={180}
              table={p ? { cols: [{ key: 'id', label: 'Canal' }, { key: 'si', label: 'Autoriza', fmt: 'int' }, { key: 'no', label: 'No autoriza', fmt: 'int' }], rows: p.contacto.canales } : undefined}>
              {g && <EChart label="Canales autorizados" option={g.canales} height={180} />}
            </ChartCard>
            <ChartCard title="Qué tan completas están las fichas" subtitle={`${fmtNum(p?.contacto.datos.con_celular)} con celular válido · ${fmtNum(p?.contacto.datos.con_email)} con correo válido`} cargando={cargando} height={180}
              table={p ? { cols: [{ key: 'id', label: 'Completitud' }, { key: 'n', label: 'Clientes', fmt: 'int' }], rows: p.completitud } : undefined}>
              {g && <EChart label="Completitud de las fichas" option={g.completitud} height={180} />}
            </ChartCard>
          </div>
        </Seccion>
      </Estado>
    </div>
  )
}

function SinVentas() {
  return <Vacio texto="Sin ventas del ERP para esta selección." />
}
function Vacio({ texto }: { texto: string }) {
  return <div className="grid h-32 place-items-center rounded-xl border border-dashed border-line-strong px-4 text-center text-[13px] text-ink-3">{texto}</div>
}
