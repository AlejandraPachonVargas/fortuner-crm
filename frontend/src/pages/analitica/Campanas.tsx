import clsx from 'clsx'
import { FilterX, Megaphone } from 'lucide-react'
import { useMemo } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import EChart, { useChartTokens } from '@/charts/EChart'
import { columnsOption, donutOption, filaTip, fmtV, piramideOption, rankingOption } from '@/charts/builders'
import { Badge, Btn, Notice } from '@/components/ui'
import { CANAL_LABEL, fmtCop, fmtFecha, fmtNum, fmtNum1, fmtPct } from '@/lib/format'
import { fechaISO, textoVigencia } from '@/lib/programacion'
import { ChartCard, consulta, Estado, Filtro, Kpi, Seccion, useTablero } from './kit'

type N = number
interface FilaCampana {
  id: string; nombre: string; estado: 'borrador' | 'programada' | 'publicada'; fecha: string | null; paso: N; destinatarios: N; control: N
  costo: N; productos: N; canales: string[]; objetivo: string; ventana_desde: string | null; ventana_hasta: string | null; vigencia_real: boolean
  cobertura: 'sin_datos' | 'parcial' | 'completa' | null; tasa_envio: N | null; tasa_control: N | null; lift_pp: N | null
  venta_promo: N | null; venta_por_dest_envio: N | null; venta_por_dest_control: N | null; incremental: N | null; roi: N | null
}
interface Tablero {
  corte: string | null; aviso: string | null
  kpis: Record<string, N | null>
  por_mes: { mes: string; borrador: N; programada: N; publicada: N; destinatarios: N; costo: N }[]
  canales: { id: string; n: N; costo_unitario: N }[]; canales_campana: { id: string; n: N }[]
  productos: { nombre: string; n: N }[]; categorias: { nombre: string; n: N }[]; objetivos: { id: string; nombre: string; n: N }[]
  borradores_paso: { paso: N; n: N }[]; presion: { campanas: N; personas: N }[]
  perfil: null | { rfm: { id: string; nombre: string; n: N }[]; edad_sexo: { edad: string; sexo: string; n: N }[] }
  campanas_tabla: FilaCampana[]
}

const ESTADOS: Record<string, string> = { publicada: 'Publicadas', programada: 'Programadas', borrador: 'Borradores' }
const ESTADO_UNO: Record<string, string> = { publicada: 'Publicada', programada: 'Programada', borrador: 'Borrador' }
const PASOS = ['', 'Productos', 'Mensaje', 'Audiencia', 'Revisar y publicar']
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
const mes = (m: string) => { const [y, mm] = m.split('-'); return mm ? `${MESES[Number(mm) - 1] ?? mm} ${y.slice(2)}` : m }
const EDADES = ['18-24', '25-34', '35-44', '45-54', '55-64', '65+']
const COBERTURA: Record<string, { label: string; tone: 'good' | 'warn' | 'neutral' }> = {
  completa: { label: 'Medida', tone: 'good' }, parcial: { label: 'Parcial', tone: 'warn' }, sin_datos: { label: 'Sin ventas aún', tone: 'neutral' },
}

function rango(dias: number | 'anio'): { desde: string; hasta: string } {
  const h = new Date()
  const d = new Date()
  if (dias === 'anio') d.setMonth(0, 1); else d.setDate(d.getDate() - dias + 1)
  return { desde: fechaISO(d), hasta: fechaISO(h) }
}

export default function AnaliticaCampanas() {
  const t = useChartTokens()
  const [sp, setSp] = useSearchParams()
  const f = { desde: sp.get('desde') ?? '', hasta: sp.get('hasta') ?? '', estados: (sp.get('estados') ?? '').split(',').filter(Boolean) }
  const set = (cambios: Partial<{ desde: string; hasta: string; estados: string[] }>) => {
    const n = new URLSearchParams(sp)
    for (const [k, v] of Object.entries(cambios)) {
      const s = Array.isArray(v) ? v.join(',') : v
      if (s) n.set(k, s); else n.delete(k)
    }
    setSp(n, { replace: true })
  }
  const q = useTablero<Tablero>(`/analitica/campanas${consulta(f)}`)
  const d = q.data
  const k = d?.kpis ?? {}
  const cargando = q.isLoading
  const hayFiltro = !!(f.desde || f.hasta || f.estados.length)

  const g = useMemo(() => {
    if (!d) return null
    const meses = d.por_mes
    const canalesEnvio = d.canales.filter((c) => c.n > 0)
    const medidas = d.campanas_tabla.filter((c) => c.tasa_envio != null).slice(0, 12)
    const dem = (sexo: string) => EDADES.map((e) => d.perfil?.edad_sexo.filter((x) => x.edad === e && x.sexo === sexo).reduce((s, x) => s + x.n, 0) ?? 0)
    return {
      porMes: columnsOption(t, { fmt: 'int', stacked: true, labels: meses.map((m) => mes(m.mes)), series: [
        { name: 'Publicadas', color: t.series[1], data: meses.map((m) => m.publicada) },
        { name: 'Programadas', color: t.series[0], data: meses.map((m) => m.programada) },
        { name: 'Borradores', color: t.compare, data: meses.map((m) => m.borrador) },
      ] }),
      alcance: columnsOption(t, { fmt: 'int', labels: meses.map((m) => mes(m.mes)), series: [{ name: 'Destinatarios', color: t.series[0], data: meses.map((m) => m.destinatarios) }] }),
      costo: columnsOption(t, { fmt: 'money', labels: meses.map((m) => mes(m.mes)), series: [{ name: 'Costo estimado', color: t.series[5], data: meses.map((m) => m.costo) }] }),
      canales: donutOption(t, { fmt: 'int', items: canalesEnvio.map((c, i) => ({ name: CANAL_LABEL[c.id] ?? c.id, value: c.n, color: t.series[[1, 0, 3][i % 3]] })), leyendaAbajo: false }),
      costoCanal: rankingOption(t, { fmt: 'money', categories: canalesEnvio.map((c) => CANAL_LABEL[c.id] ?? c.id), values: canalesEnvio.map((c) => c.n * c.costo_unitario),
        extra: (i) => filaTip(t.compare, 'Mensajes', fmtV(canalesEnvio[i].n, 'int', false)) + filaTip(t.compare, 'Costo por mensaje (supuesto)', fmtV(canalesEnvio[i].costo_unitario, 'money', false)) }),
      productos: rankingOption(t, { fmt: 'int', categories: d.productos.map((p) => p.nombre), values: d.productos.map((p) => p.n), labelWidth: 200 }),
      categorias: donutOption(t, { fmt: 'int', items: d.categorias.map((c) => ({ name: c.nombre, value: c.n })) }),
      objetivos: donutOption(t, { fmt: 'int', items: d.objetivos.map((o) => ({ name: o.nombre, value: o.n })) }),
      borradores: columnsOption(t, { fmt: 'int', labels: d.borradores_paso.map((b) => PASOS[b.paso]), series: [{ name: 'Borradores', color: t.series[5], data: d.borradores_paso.map((b) => b.n) }] }),
      presion: columnsOption(t, { fmt: 'int', labels: d.presion.map((p) => (p.campanas >= 4 ? '4 o más' : `${p.campanas}`)), series: [{ name: 'Personas', color: t.series[4], data: d.presion.map((p) => p.personas) }] }),
      rfm: d.perfil ? rankingOption(t, { fmt: 'int', categories: d.perfil.rfm.map((r) => r.nombre), values: d.perfil.rfm.map((r) => r.n), colors: d.perfil.rfm.map(() => t.series[2]) }) : null,
      piramide: d.perfil ? piramideOption(t, { bandas: EDADES, mujeres: dem('F'), hombres: dem('M') }) : null,
      efectividad: medidas.length ? columnsOption(t, { fmt: 'pct', labels: medidas.map((m) => m.nombre.slice(0, 24)), series: [
        { name: 'Recibieron el mensaje', color: t.series[0], data: medidas.map((m) => m.tasa_envio) },
        { name: 'Grupo de control', color: t.compare, data: medidas.map((m) => m.tasa_control) },
      ] }) : null,
    }
  }, [d, t])

  const cobertura = useMemo(() => {
    const c = { completa: 0, parcial: 0, sin_datos: 0 }
    for (const x of d?.campanas_tabla ?? []) if (x.cobertura) c[x.cobertura]++
    return c
  }, [d])
  const altura = (n: number) => Math.max(140, n * 28 + 30)

  return (
    <div className="mx-auto max-w-[1400px] space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-[24px] font-semibold text-ink"><Megaphone size={22} className="text-brand" />Analítica de campañas</h1>
          <p className="text-[13px] text-ink-3">Cuántas campañas se hacen, a quién llegan, por qué canal, cuánto cuestan y cuánto venden de verdad frente al grupo de control.</p>
        </div>
        {d?.corte && <span className="rounded-full bg-surface-2 px-3 py-1 text-[12px] text-ink-3">Ventas para medir efectividad hasta <b className="text-ink">{fmtFecha(d.corte)}</b></span>}
      </div>

      <section className="card p-4" aria-label="Filtros">
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-[12px] font-semibold text-ink-2">Desde
            <input type="date" value={f.desde} max={f.hasta || undefined} onChange={(e) => set({ desde: e.target.value })} className="mt-1 block h-9 rounded-lg border border-line-strong bg-surface px-2.5 text-[13px] font-normal text-ink" /></label>
          <label className="text-[12px] font-semibold text-ink-2">Hasta
            <input type="date" value={f.hasta} min={f.desde || undefined} onChange={(e) => set({ hasta: e.target.value })} className="mt-1 block h-9 rounded-lg border border-line-strong bg-surface px-2.5 text-[13px] font-normal text-ink" /></label>
          <div className="flex flex-wrap gap-1.5">
            {([['30 días', 30], ['90 días', 90], ['Este año', 'anio']] as const).map(([l, v]) => (
              <button key={l} type="button" onClick={() => set(rango(v))} className="h-9 rounded-lg border border-line-strong px-2.5 text-[12.5px] font-medium text-ink-2 hover:bg-surface-hover">{l}</button>
            ))}
            <button type="button" onClick={() => set({ desde: '', hasta: '' })} className="h-9 rounded-lg border border-line-strong px-2.5 text-[12.5px] font-medium text-ink-2 hover:bg-surface-hover">Todo</button>
          </div>
          <div className="ml-auto flex flex-wrap items-end gap-2">
            <Filtro label="Estado" valor={f.estados} onChange={(v) => set({ estados: v })} opciones={Object.entries(ESTADOS).map(([id, label]) => ({ id, label }))} />
            {hayFiltro && <Btn small variant="ghost" icon={<FilterX size={14} />} onClick={() => setSp(new URLSearchParams(), { replace: true })}>Limpiar</Btn>}
          </div>
        </div>
      </section>

      <Estado error={q.error} cargando={q.isFetching}>
        {d?.aviso && <Notice tone="info">{d.aviso}</Notice>}
        {d && k.campanas === 0 && <Notice tone="info">No hay campañas en el periodo y estado elegidos.</Notice>}

        <Seccion titulo="Resumen">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {cargando ? Array.from({ length: 8 }, (_, i) => <div key={i} className="skeleton h-[98px] rounded-2xl" />) : <>
              <Kpi label="Campañas" value={fmtNum(k.campanas)} sub={`${fmtNum(k.publicadas)} publicadas · ${fmtNum(k.programadas)} programadas · ${fmtNum(k.borradores)} borradores`} />
              <Kpi label="Mensajes a enviar" value={fmtNum(k.destinatarios)} sub={`${fmtNum(k.personas_unicas)} personas distintas`} />
              <Kpi label="Costo estimado" value={fmtCop(k.costo)} sub={`${fmtCop(k.costo_por_contacto)} por persona`} />
              <Kpi label="Grupo de control" value={fmtNum(k.control)} sub="Reservados sin mensaje para medir" />
              <Kpi label="Campañas por persona" value={fmtNum1(k.campanas_por_persona)} sub="Presión de contacto promedio" tone={(k.campanas_por_persona ?? 0) > 2 ? 'warn' : 'good'} />
              <Kpi label="Vigencia promedio" value={k.vigencia_prom != null ? `${fmtNum1(k.vigencia_prom)} días` : '—'} sub={`${fmtNum(k.productos_distintos)} productos promocionados`} />
              <Kpi label="Compraron lo promocionado" value={k.tasa_envio != null ? fmtPct(k.tasa_envio) : '—'} sub={k.medidas ? `Promedio de ${fmtNum(k.medidas)} campaña(s) medidas` : 'Aún sin campañas medibles'} pct={k.tasa_envio} tone="good" />
              <Kpi label="Efecto real (vs control)" value={k.lift_pp != null ? `${k.lift_pp > 0 ? '+' : ''}${fmtNum1(k.lift_pp)} pp` : '—'} sub={k.incremental != null ? `${fmtCop(k.incremental)} de venta incremental` : 'Requiere grupo de control y ventas'} tone={(k.lift_pp ?? 0) > 0 ? 'good' : 'warn'} />
            </>}
          </div>
        </Seccion>

        <Seccion titulo="Actividad">
          <div className="grid gap-4 lg:grid-cols-3">
            <ChartCard title="Campañas por mes" subtitle="Por estado" cargando={cargando} height={260}
              table={d ? { cols: [{ key: 'mes', label: 'Mes' }, { key: 'publicada', label: 'Publicadas', fmt: 'int' }, { key: 'programada', label: 'Programadas', fmt: 'int' }, { key: 'borrador', label: 'Borradores', fmt: 'int' }, { key: 'destinatarios', label: 'Destinatarios', fmt: 'int' }, { key: 'costo', label: 'Costo', fmt: 'money' }], rows: d.por_mes } : undefined}>
              {g && <EChart label="Campañas por mes" option={g.porMes} height={260} />}
            </ChartCard>
            <ChartCard title="Destinatarios por mes" subtitle="Personas que reciben (o recibirán) mensaje" cargando={cargando} height={260}>
              {g && <EChart label="Destinatarios por mes" option={g.alcance} height={260} />}
            </ChartCard>
            <ChartCard title="Costo estimado por mes" subtitle="Con las tarifas supuestas por mensaje" cargando={cargando} height={260}>
              {g && <EChart label="Costo por mes" option={g.costo} height={260} />}
            </ChartCard>
          </div>
        </Seccion>

        <Seccion titulo="Canales, productos y objetivos">
          <div className="grid gap-4 lg:grid-cols-3">
            <ChartCard title="Mensajes por canal" subtitle="Envíos de las campañas publicadas y programadas" cargando={cargando} height={240}
              table={d ? { cols: [{ key: 'id', label: 'Canal' }, { key: 'n', label: 'Mensajes', fmt: 'int' }, { key: 'costo_unitario', label: 'Costo unitario', fmt: 'money' }], rows: d.canales } : undefined}>
              {g && (d!.canales.some((c) => c.n) ? <EChart label="Mensajes por canal" option={g.canales} height={240} /> : <Vacio texto="Aún no hay campañas lanzadas." />)}
            </ChartCard>
            <ChartCard title="Costo por canal" subtitle="Mensajes × tarifa supuesta (WhatsApp $120, SMS $45, correo $3)" cargando={cargando} height={240}
              info="Tarifas de referencia mientras se contrata el proveedor; el costo real dependerá del contrato.">
              {g && (d!.canales.some((c) => c.n) ? <EChart label="Costo por canal" option={g.costoCanal} height={240} /> : <Vacio texto="Aún no hay campañas lanzadas." />)}
            </ChartCard>
            <ChartCard title="Objetivo de las campañas" cargando={cargando} height={240}
              table={d ? { cols: [{ key: 'nombre', label: 'Objetivo' }, { key: 'n', label: 'Campañas', fmt: 'int' }], rows: d.objetivos } : undefined}>
              {g && (d!.objetivos.length ? <EChart label="Objetivos" option={g.objetivos} height={240} /> : <Vacio texto="Sin campañas." />)}
            </ChartCard>
            <ChartCard className="lg:col-span-2" title="Productos más promocionados" subtitle="En cuántas campañas aparece cada producto" cargando={cargando} height={altura(d?.productos.length ?? 8)}
              table={d ? { cols: [{ key: 'nombre', label: 'Producto' }, { key: 'n', label: 'Campañas', fmt: 'int' }], rows: d.productos } : undefined}>
              {g && (d!.productos.length ? <EChart label="Productos promocionados" option={g.productos} height={altura(d!.productos.length)} /> : <Vacio texto="Sin productos." />)}
            </ChartCard>
            <ChartCard title="Categorías promocionadas" subtitle="Grupo de los productos" cargando={cargando} height={260}
              table={d ? { cols: [{ key: 'nombre', label: 'Categoría' }, { key: 'n', label: 'Productos en campañas', fmt: 'int' }], rows: d.categorias } : undefined}>
              {g && (d!.categorias.length ? <EChart label="Categorías promocionadas" option={g.categorias} height={260} /> : <Vacio texto="Sin productos." />)}
            </ChartCard>
          </div>
        </Seccion>

        <Seccion titulo="A quién llegan">
          <div className="grid gap-4 lg:grid-cols-3">
            <ChartCard title="Segmento de quienes reciben" subtitle="Valor y fidelidad (RFM) de las personas contactadas" cargando={cargando} height={altura(d?.perfil?.rfm.length ?? 8)}
              table={d?.perfil ? { cols: [{ key: 'nombre', label: 'Segmento' }, { key: 'n', label: 'Personas', fmt: 'int' }], rows: d.perfil.rfm } : undefined}>
              {g?.rfm ? <EChart label="Segmento de los contactados" option={g.rfm} height={altura(d!.perfil!.rfm.length)} /> : <Vacio texto="Aún no hay destinatarios." />}
            </ChartCard>
            <ChartCard title="Edad y sexo de quienes reciben" cargando={cargando} height={280}>
              {g?.piramide ? <EChart label="Edad y sexo de los contactados" option={g.piramide} height={280} /> : <Vacio texto="Aún no hay destinatarios." />}
            </ChartCard>
            <ChartCard title="Presión de contacto" subtitle="Personas según cuántas campañas recibieron en el periodo" cargando={cargando} height={280}
              info="Escribirle muchas veces a la misma persona cansa y aumenta los retiros de autorización. Use «Excluir contactados en los últimos N días» al segmentar."
              table={d ? { cols: [{ key: 'campanas', label: 'Campañas', fmt: 'int' }, { key: 'personas', label: 'Personas', fmt: 'int' }], rows: d.presion } : undefined}>
              {g && <EChart label="Presión de contacto" option={g.presion} height={280} />}
            </ChartCard>
          </div>
        </Seccion>

        <Seccion titulo="Efectividad">
          <Notice tone="info">
            Hoy los envíos son <b>simulados</b>: la medición queda lista para cuando la difusión sea real. Una campaña se mide cuando las ventas del ERP cubren su vigencia
            (hoy llegan hasta el {fmtFecha(d?.corte)}). Medidas: <b>{cobertura.completa}</b> · parciales: <b>{cobertura.parcial}</b> · esperando ventas: <b>{cobertura.sin_datos}</b>.
            Para medir el efecto real, publique con un <b>grupo de control</b> (recomendado 10 %).
          </Notice>
          <div className="grid gap-4 lg:grid-cols-3">
            <ChartCard className="lg:col-span-2" title="% que compró lo promocionado: con mensaje vs control" subtitle="Durante la vigencia de cada campaña" cargando={cargando} height={280}>
              {g?.efectividad ? <EChart label="Efectividad por campaña" option={g.efectividad} height={280} /> : <Vacio texto="Todavía no hay campañas con ventas en su vigencia para medir." />}
            </ChartCard>
            <ChartCard title="¿En qué paso quedan los borradores?" subtitle="Campañas sin terminar según el último paso guardado" cargando={cargando} height={280}>
              {g && <EChart label="Borradores por paso" option={g.borradores} height={280} />}
            </ChartCard>
          </div>
        </Seccion>

        <Seccion titulo="Detalle de las campañas">
          <ChartCard title="Todas las campañas del periodo" subtitle="Clic en el nombre para abrir la campaña" cargando={cargando} height={300}
            table={d ? { cols: [
              { key: 'nombre', label: 'Campaña' }, { key: 'estado', label: 'Estado' }, { key: 'fecha', label: 'Fecha' }, { key: 'destinatarios', label: 'Destinatarios', fmt: 'int' },
              { key: 'control', label: 'Control', fmt: 'int' }, { key: 'costo', label: 'Costo', fmt: 'money' }, { key: 'ventana_desde', label: 'Vigencia desde' }, { key: 'ventana_hasta', label: 'Vigencia hasta' },
              { key: 'cobertura', label: 'Medición' }, { key: 'tasa_envio', label: '% compró (envío)', fmt: 'pct' }, { key: 'tasa_control', label: '% compró (control)', fmt: 'pct' },
              { key: 'lift_pp', label: 'Efecto (puntos porcentuales)' }, { key: 'incremental', label: 'Venta incremental', fmt: 'money' }, { key: 'roi', label: 'Retorno (veces el costo)' },
            ], rows: d.campanas_tabla } : undefined}>
            {d && (d.campanas_tabla.length ? (
              <div className="overflow-x-auto scroll-thin">
                <table className="w-full min-w-[960px] text-[12.5px]">
                  <thead><tr className="text-left">
                    {['Campaña', 'Estado', 'Destinatarios', 'Costo', 'Vigencia', 'Medición', '% compró (envío / control)', 'Efecto', 'Venta incremental'].map((h) => <th key={h} scope="col" className="px-2 py-2 font-semibold">{h}</th>)}
                  </tr></thead>
                  <tbody>{d.campanas_tabla.map((c) => (
                    <tr key={c.id} className="border-t border-line align-top">
                      <td className="px-2 py-2"><Link to={`/campanas/${c.id}`} className="font-semibold text-brand hover:underline">{c.nombre}</Link><div className="text-[11.5px] text-ink-3">{fmtFecha(c.fecha)} · {c.productos} producto(s) · {c.canales.map((x) => CANAL_LABEL[x] ?? x).join(', ') || 'sin canal'}</div></td>
                      <td className="px-2 py-2 whitespace-nowrap"><Badge tone={c.estado === 'publicada' ? 'good' : c.estado === 'programada' ? 'brand' : 'warn'}>{ESTADO_UNO[c.estado] ?? c.estado}</Badge></td>
                      <td className="px-2 py-2 tnum">{fmtNum(c.destinatarios)}{c.control > 0 && <div className="text-[11.5px] text-ink-3">+{fmtNum(c.control)} control</div>}</td>
                      <td className="px-2 py-2 tnum">{c.estado === 'borrador' ? '—' : fmtCop(c.costo)}</td>
                      <td className="px-2 py-2">{c.ventana_desde && c.ventana_hasta ? <>{textoVigencia(c.ventana_desde, c.ventana_hasta)}{!c.vigencia_real && <div className="text-[11px] text-ink-3">sin vigencia: se miden 7 días</div>}</> : '—'}</td>
                      <td className="px-2 py-2 whitespace-nowrap">{c.cobertura ? <Badge tone={COBERTURA[c.cobertura].tone}>{COBERTURA[c.cobertura].label}</Badge> : '—'}</td>
                      <td className="px-2 py-2 tnum">{c.tasa_envio != null ? <>{fmtPct(c.tasa_envio)} / {c.tasa_control != null ? fmtPct(c.tasa_control) : 'sin control'}</> : '—'}</td>
                      <td className={clsx('px-2 py-2 tnum font-semibold', (c.lift_pp ?? 0) > 0 ? 'text-good' : (c.lift_pp ?? 0) < 0 ? 'text-bad' : 'text-ink-3')}>{c.lift_pp != null ? `${c.lift_pp > 0 ? '+' : ''}${fmtNum1(c.lift_pp)} pp` : '—'}</td>
                      <td className="px-2 py-2 tnum">{c.incremental != null ? <>{fmtCop(c.incremental)}{c.roi != null && <div className="text-[11.5px] text-ink-3">{fmtNum1(c.roi)} veces el costo</div>}</> : '—'}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            ) : <Vacio texto="No hay campañas en el periodo." />)}
          </ChartCard>
        </Seccion>
      </Estado>
    </div>
  )
}

function Vacio({ texto }: { texto: string }) {
  return <div className="grid h-32 place-items-center rounded-xl border border-dashed border-line-strong px-4 text-center text-[13px] text-ink-3">{texto}</div>
}
