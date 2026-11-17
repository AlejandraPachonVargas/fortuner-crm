import * as echarts from 'echarts/core'
import { BarChart, HeatmapChart, LineChart, PieChart } from 'echarts/charts'
import { GridComponent, LegendComponent, MarkLineComponent, TooltipComponent, VisualMapComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import type { EChartsCoreOption } from 'echarts/core'
import { useEffect, useMemo, useRef, useState } from 'react'
import { tokens, type ChartTokens, type Mode } from './theme'

// Mismo motor y tema que fortuner-dashboards. Registro modular: solo se empaqueta lo que se usa.
echarts.use([BarChart, LineChart, PieChart, HeatmapChart, GridComponent, TooltipComponent, LegendComponent,
  VisualMapComponent, MarkLineComponent, CanvasRenderer])

function baseTheme(mode: Mode) {
  const t = tokens(mode)
  return {
    color: t.series,
    backgroundColor: 'transparent',
    textStyle: { fontFamily: '"Inter Variable", system-ui, sans-serif', color: t.ink2, fontSize: 12 },
    categoryAxis: { axisLine: { lineStyle: { color: t.axis } }, axisTick: { show: false }, axisLabel: { color: t.muted, fontSize: 11 }, splitLine: { show: false } },
    valueAxis: { axisLine: { show: false }, axisTick: { show: false }, axisLabel: { color: t.muted, fontSize: 11 }, splitLine: { lineStyle: { color: t.grid, type: 'solid', width: 1 } } },
    legend: { textStyle: { color: t.ink2, fontSize: 12 }, icon: 'roundRect', itemWidth: 10, itemHeight: 10, itemGap: 16 },
    tooltip: {
      backgroundColor: t.tooltipBg, borderColor: t.tooltipBorder, borderWidth: 1, padding: [8, 12],
      textStyle: { color: t.ink, fontSize: 12 }, extraCssText: 'border-radius:10px;box-shadow:0 6px 24px rgba(0,0,0,.12);',
    },
    line: { symbolSize: 7, lineStyle: { width: 2 } },
    bar: { itemStyle: { borderRadius: [4, 4, 0, 0] } },
  }
}
echarts.registerTheme('fortuner-light', baseTheme('light'))
echarts.registerTheme('fortuner-dark', baseTheme('dark'))

const temaDoc = (): Mode => (document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light')

/** Tema activo del CRM (el botón de la cabecera cambia `data-theme` en <html>): las gráficas lo siguen al instante. */
export function useTema(): Mode {
  const [t, setT] = useState<Mode>(temaDoc)
  useEffect(() => {
    const mo = new MutationObserver(() => setT(temaDoc()))
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    return () => mo.disconnect()
  }, [])
  return t
}

export function useChartTokens(): ChartTokens {
  const tema = useTema()
  return useMemo(() => tokens(tema), [tema])
}

export interface ChartClick { name?: string; dataIndex?: number; seriesName?: string; value?: unknown }

interface Props { option: EChartsCoreOption; height?: number; onClick?: (p: ChartClick) => void; label: string; className?: string }

/** Gráfica ECharts accesible (role=img + etiqueta), redimensionable y con el tema Fortuner claro/oscuro. */
export default function EChart({ option, height = 280, onClick, label, className }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const chart = useRef<echarts.ECharts | null>(null)
  const tema = useTema()
  const clickRef = useRef(onClick)
  useEffect(() => { clickRef.current = onClick })

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const c = echarts.init(el, `fortuner-${tema}`, { renderer: 'canvas' })
    chart.current = c
    c.on('click', (p) => clickRef.current?.(p as ChartClick))
    const ro = new ResizeObserver(() => c.resize())
    ro.observe(el)
    return () => { ro.disconnect(); c.dispose(); chart.current = null }
  }, [tema])

  useEffect(() => { chart.current?.setOption(option, { notMerge: true }) }, [option, tema])

  return <div ref={ref} role="img" aria-label={label} className={className} style={{ height, width: '100%', cursor: onClick ? 'pointer' : undefined }} />
}
