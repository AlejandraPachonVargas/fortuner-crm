// Constructores de opciones ECharts (mismas reglas de diseño que fortuner-dashboards):
//  · Un solo eje Y; marcas delgadas, barras con extremo redondeado de 4px, grilla tenue.
//  · Tooltip en todas las gráficas; leyenda solo con ≥ 2 series; etiquetas directas cuando ayudan.
//  · Los textos que vienen de la base de datos se ESCAPAN antes de ir al HTML del tooltip.
import type { EChartsCoreOption } from 'echarts/core'
import { fmtCop, fmtCopCorto, fmtNum, fmtPct } from '@/lib/format'
import { HEAT, type ChartTokens } from './theme'

export type Fmt = 'int' | 'money' | 'pct'

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
export const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c] ?? c)
const COLOR_OK = /^(#[0-9a-f]{3,8}|(rgb|hsl)a?\([\d\s.,%/-]+\))$/i
export const safeColor = (c: unknown, fallback = '#8A97A3') => (typeof c === 'string' && COLOR_OK.test(c.trim()) ? c.trim() : fallback)

const nfCorto = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 1 })
/** Valor formateado. `corto` abrevia SOLO las marcas de los ejes («$20.000 millones», «25,3 mil»); el resto, exacto. */
export function fmtV(v: unknown, fmt: Fmt, corto = true): string {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : null
  if (n == null) return '—'
  if (fmt === 'money') return corto ? fmtCopCorto(n) : fmtCop(n)
  if (fmt === 'pct') return fmtPct(n)
  if (corto && Math.abs(n) >= 1e6) return `${nfCorto.format(n / 1e6)} millones`
  if (corto && Math.abs(n) >= 1e4) return `${nfCorto.format(n / 1e3)} mil`
  return fmtNum(n)
}

const dot = (c: string) => `<span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${safeColor(c)};margin-right:6px"></span>`
export const filaTip = (color: string, nombre: string, valor: string) =>
  `<div style="display:flex;justify-content:space-between;gap:18px;line-height:20px"><span>${dot(color)}${esc(nombre)}</span><b style="font-variant-numeric:tabular-nums">${esc(valor)}</b></div>`
const titulo = (s: string) => `<div style="font-weight:600;margin-bottom:4px">${esc(s)}</div>`

interface FP { dataIndex: number; seriesName: string; name: string; color: string; percent: number; value: unknown }
const gridBase = { left: 8, right: 16, top: 16, bottom: 8, containLabel: true }

// ----------------------------------------------------------------- barras horizontales (ranking)
export function rankingOption(t: ChartTokens, o: {
  categories: string[]; values: (number | null)[]; fmt: Fmt; colors?: string[]; labelWidth?: number
  margenIzq?: number   // margen extra a la izquierda (etiquetas que se miden antes de cargar la fuente)
  extra?: (i: number) => string   // filas adicionales del tooltip (HTML ya escapado con filaTip)
}): EChartsCoreOption {
  const cats = [...o.categories].reverse()
  const vals = [...o.values].reverse()
  const cols = o.colors ? [...o.colors].reverse() : undefined
  const n = o.categories.length
  return {
    grid: { ...gridBase, left: o.margenIzq ?? gridBase.left, right: o.fmt === 'money' ? 130 : 70, top: 8 },
    tooltip: {
      trigger: 'axis', axisPointer: { type: 'shadow', shadowStyle: { color: t.grid + '88' } },
      formatter: (ps: FP[]) => {
        const i = ps[0].dataIndex
        return titulo(cats[i]) + filaTip(cols?.[i] ?? t.series[0], 'Valor', fmtV(vals[i], o.fmt, false)) + (o.extra ? o.extra(n - 1 - i) : '')
      },
    },
    xAxis: { type: 'value', minInterval: o.fmt === 'int' ? 1 : undefined, axisLabel: { formatter: (v: number) => fmtV(v, o.fmt), hideOverlap: true }, splitNumber: 4 },
    yAxis: { type: 'category', data: cats, axisLabel: { width: o.labelWidth ?? 140, overflow: 'truncate', color: t.ink2, fontSize: 11 } },
    series: [{
      type: 'bar', barMaxWidth: 18,
      data: vals.map((v, i) => ({ value: v, itemStyle: { color: safeColor(cols?.[i], t.series[0]), borderRadius: [0, 4, 4, 0] } })),
      label: { show: true, position: 'right', color: t.ink2, fontSize: 11, formatter: (p: FP) => fmtV(p.value, o.fmt, false) },
    }],
  }
}

// ----------------------------------------------------------------- dona
export function donutOption(t: ChartTokens, o: { items: { name: string; value: number; color?: string }[]; fmt: Fmt; centro?: string; leyendaAbajo?: boolean }): EChartsCoreOption {
  let items = o.items.filter((x) => x.value > 0).sort((a, b) => b.value - a.value)
  if (items.length > 7) {
    const resto = items.slice(6).reduce((s, x) => s + x.value, 0)
    items = [...items.slice(0, 6), { name: 'Otros', value: resto, color: t.compare }]
  }
  const total = items.reduce((s, x) => s + x.value, 0)
  const share = (n: string) => fmtPct(total ? (100 * (items.find((i) => i.name === n)?.value ?? 0)) / total : 0)
  // Leyenda abajo si hay muchas porciones o nombres largos (a la derecha se montaría sobre la dona).
  const abajo = o.leyendaAbajo ?? (items.length > 4 || Math.max(0, ...items.map((x) => x.name.length)) > 14)
  return {
    tooltip: { trigger: 'item', formatter: (p: FP) => titulo(p.name) + `${esc(fmtV(p.value, o.fmt, false))} · ${esc(fmtPct(p.percent))}` },
    legend: abajo
      ? { orient: 'horizontal', bottom: 0, left: 'center', itemGap: 10, formatter: (n: string) => `${n}  ${share(n)}` }
      : { orient: 'vertical', right: 0, top: 'middle', formatter: (n: string) => `${n}  ${share(n)}` },
    series: [{
      type: 'pie', radius: abajo ? ['42%', '64%'] : ['55%', '80%'], center: abajo ? ['50%', '40%'] : ['32%', '50%'], avoidLabelOverlap: true,
      itemStyle: { borderColor: t.surface, borderWidth: 2, borderRadius: 4 },
      label: { show: true, position: 'center', formatter: () => o.centro ?? (o.fmt === 'money' ? '' : fmtV(total, o.fmt, false)), fontSize: 16, fontWeight: 700, color: t.ink },
      emphasis: { scale: false, label: { show: true } },
      data: items.map((x, i) => ({ name: x.name, value: x.value, itemStyle: { color: safeColor(x.color, t.series[i % t.series.length]) } })),
    }],
  }
}

// ----------------------------------------------------------------- columnas agrupadas o apiladas
export function columnsOption(t: ChartTokens, o: {
  labels: string[]; series: { name: string; data: (number | null)[]; color: string }[]; fmt: Fmt; stacked?: boolean; horizontal?: boolean
  ejeX?: string   // nombre del eje de categorías (debajo de las barras), p. ej. «Número de compras»
}): EChartsCoreOption {
  // Pocas categorías: se muestran TODAS las etiquetas (si no, ECharts oculta una sí y una no).
  const cat = { type: 'category', data: o.labels, axisLabel: { hideOverlap: o.labels.length > 10, color: t.ink2, interval: o.horizontal || o.labels.length <= 10 ? 0 : 'auto', fontSize: 11 } }
  // Conteos: sin marcas fraccionarias en el eje («0, 1, 1, 2» con pocos datos).
  const val = { type: 'value', minInterval: o.fmt === 'int' ? 1 : undefined, axisLabel: { formatter: (v: number) => fmtV(v, o.fmt) } }
  const multi = o.series.length > 1
  return {
    grid: { ...gridBase, top: multi ? 36 : 16, bottom: o.ejeX && !o.horizontal ? 26 : gridBase.bottom },
    legend: multi ? { top: 0, left: 0 } : undefined,
    tooltip: {
      trigger: 'axis', axisPointer: { type: 'shadow', shadowStyle: { color: t.grid + '88' } },
      formatter: (ps: FP[]) => titulo(o.labels[ps[0].dataIndex]) + ps.map((p) => filaTip(p.color, p.seriesName, fmtV(p.value, o.fmt, false))).join(''),
    },
    xAxis: o.horizontal ? val : (o.ejeX ? { ...cat, name: o.ejeX, nameLocation: 'middle', nameGap: 28, nameTextStyle: { color: t.muted, fontSize: 11 } } : cat),
    yAxis: o.horizontal ? { ...cat, inverse: true } : val,
    series: o.series.map((s, i) => ({
      name: s.name, type: 'bar', data: s.data, stack: o.stacked ? 'x' : undefined, barMaxWidth: 34, barGap: '12%',
      itemStyle: {
        color: safeColor(s.color, t.series[i % t.series.length]), borderColor: o.stacked ? t.surface : undefined, borderWidth: o.stacked ? 1 : 0,
        borderRadius: o.stacked ? (i === o.series.length - 1 ? (o.horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0]) : 0) : o.horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0],
      },
    })),
  }
}

// ----------------------------------------------------------------- líneas (tendencias)
export function lineOption(t: ChartTokens, o: { labels: string[]; series: { name: string; data: (number | null)[]; color: string; area?: boolean }[]; fmt: Fmt }): EChartsCoreOption {
  const multi = o.series.length > 1
  return {
    grid: { ...gridBase, top: multi ? 36 : 16 },
    legend: multi ? { top: 0, left: 0 } : undefined,
    tooltip: {
      trigger: 'axis', axisPointer: { type: 'line', lineStyle: { color: t.axis } },
      formatter: (ps: FP[]) => titulo(o.labels[ps[0].dataIndex]) + ps.map((p) => filaTip(p.color, p.seriesName, fmtV(p.value, o.fmt, false))).join(''),
    },
    xAxis: { type: 'category', data: o.labels, boundaryGap: false, axisLabel: { hideOverlap: true } },
    yAxis: { type: 'value', axisLabel: { formatter: (v: number) => fmtV(v, o.fmt) } },
    series: o.series.map((s) => {
      const c = safeColor(s.color, t.series[0])
      return {
        name: s.name, type: 'line', data: s.data, showSymbol: o.labels.length < 24, symbol: 'circle', symbolSize: 7, connectNulls: false,
        lineStyle: { width: 2.5, color: c }, itemStyle: { color: c, borderColor: t.surface, borderWidth: 2 },
        areaStyle: s.area ? { color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: c + '33' }, { offset: 1, color: c + '00' }] } } : undefined,
      }
    }),
  }
}

// ----------------------------------------------------------------- mapa de calor día × hora
const DIAS = ['', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo']
export function heatmapOption(t: ChartTokens, o: { rows: { dia: number; hora: number; v: number }[]; nombre: string }): EChartsCoreOption {
  const horas = [...new Set(o.rows.map((r) => r.hora))].sort((a, b) => a - b)
  const dias = [7, 6, 5, 4, 3, 2, 1]
  const data = o.rows.map((r) => [horas.indexOf(r.hora), dias.indexOf(r.dia), r.v])
  const max = Math.max(1, ...o.rows.map((r) => r.v))
  return {
    grid: { left: 8, right: 8, top: 8, bottom: 48, containLabel: true },
    tooltip: { formatter: (p: FP) => {
      const [x, y, v] = (p.value as number[]) ?? []
      return titulo(`${DIAS[dias[y] ?? 1]} · ${horas[x]}:00`) + `${esc(o.nombre)}: <b>${esc(fmtV(v, 'int', false))}</b>`
    } },
    xAxis: { type: 'category', data: horas.map((h) => `${h}h`), axisLine: { show: false } },
    yAxis: { type: 'category', data: dias.map((d) => DIAS[d].slice(0, 3)), axisLine: { show: false } },
    visualMap: {
      min: 0, max, calculable: false, orient: 'horizontal', left: 'center', bottom: 0, itemHeight: 160, itemWidth: 10,
      inRange: { color: HEAT }, text: [`Más · ${fmtV(max, 'int')}`, 'Menos'], textGap: 8, textStyle: { color: t.muted, fontSize: 11 },
    },
    series: [{ type: 'heatmap', data, itemStyle: { borderColor: t.surface, borderWidth: 2, borderRadius: 3 }, emphasis: { itemStyle: { borderColor: t.ink, borderWidth: 1 } } }],
  }
}

// ----------------------------------------------------------------- embudo (barras que se van angostando)
export function embudoOption(t: ChartTokens, o: { etapas: { nombre: string; n: number; color?: string; ayuda?: string }[] }): EChartsCoreOption {
  const base = o.etapas[0]?.n || 1
  const cats = o.etapas.map((e) => e.nombre)
  return {
    grid: { ...gridBase, right: 120, top: 4 },
    // (las etiquetas de etapa se escriben cortas para que quepan sin recortarse)
    tooltip: {
      trigger: 'axis', axisPointer: { type: 'shadow', shadowStyle: { color: t.grid + '88' } },
      formatter: (ps: FP[]) => {
        const e = o.etapas[ps[0].dataIndex]
        const prev = o.etapas[ps[0].dataIndex - 1]
        return titulo(e.nombre) + filaTip(e.color ?? t.series[0], 'Personas', fmtV(e.n, 'int', false))
          + filaTip(t.compare, 'Del total', fmtPct((100 * e.n) / base))
          + (prev ? filaTip(t.compare, 'De la etapa anterior', fmtPct(prev.n ? (100 * e.n) / prev.n : 0)) : '')
          + (e.ayuda ? `<div style="margin-top:4px;max-width:260px;white-space:normal;color:${safeColor(t.muted)}">${esc(e.ayuda)}</div>` : '')
      },
    },
    xAxis: { type: 'value', show: false, max: base },
    yAxis: { type: 'category', data: cats, inverse: true, axisLabel: { color: t.ink2, fontSize: 12, width: 190, overflow: 'break' }, axisLine: { show: false } },
    series: [{
      type: 'bar', barMaxWidth: 30,
      data: o.etapas.map((e, i) => ({ value: e.n, itemStyle: { color: safeColor(e.color, t.series[i % t.series.length]), borderRadius: [0, 6, 6, 0] } })),
      label: { show: true, position: 'right', color: t.ink, fontSize: 12, fontWeight: 600, formatter: (p: FP) => `${fmtV(p.value, 'int', false)} · ${fmtPct((100 * Number(p.value)) / base)}` },
    }],
  }
}

// ----------------------------------------------------------------- pirámide de población (edad × sexo)
export function piramideOption(t: ChartTokens, o: { bandas: string[]; mujeres: number[]; hombres: number[] }): EChartsCoreOption {
  const max = Math.max(1, ...o.mujeres, ...o.hombres)
  return {
    grid: { ...gridBase, top: 30 },
    legend: { top: 0, left: 0, data: ['Mujeres', 'Hombres'] },
    tooltip: {
      trigger: 'axis', axisPointer: { type: 'shadow', shadowStyle: { color: t.grid + '88' } },
      formatter: (ps: FP[]) => titulo(o.bandas[ps[0].dataIndex]) + ps.map((p) => filaTip(p.color, p.seriesName, fmtV(Math.abs(Number(p.value)), 'int', false))).join(''),
    },
    xAxis: { type: 'value', min: -max, max, axisLabel: { formatter: (v: number) => fmtV(Math.abs(v), 'int') } },
    yAxis: { type: 'category', data: o.bandas, axisTick: { show: false } },
    series: [
      { name: 'Mujeres', type: 'bar', stack: 'p', barMaxWidth: 22, data: o.mujeres.map((v) => -v), itemStyle: { color: t.series[4], borderRadius: [4, 0, 0, 4] } },
      { name: 'Hombres', type: 'bar', stack: 'p', barMaxWidth: 22, data: o.hombres, itemStyle: { color: t.series[0], borderRadius: [0, 4, 4, 0] } },
    ],
  }
}
