// Paleta de visualización Fortuner (GUIA_REDISENO_MODULOS.md §8, «Gráficos»).
// Categórica: los 5 primeros tonos son los de la guía, en su orden (azul, menta, esmeralda, celeste, violeta);
// los 3 últimos (ámbar, coral, gris azulado) solo entran cuando hay más de 5 entidades. El color sigue a la
// entidad, nunca a su posición en un ranking. Evitar el rojo y el verde como únicas señales (acompañar con texto).

export type Mode = 'light' | 'dark'

export const CATEGORICAL: Record<Mode, string[]> = {
  light: ['#0F70FC', '#21CC93', '#1FCEC4', '#33B1FF', '#5B5FF7', '#F5B301', '#E5684D', '#8A97A3'],
  dark: ['#4D9BFF', '#21CC93', '#1FCEC4', '#5CC0FF', '#8A8DFF', '#F5C24A', '#F27A6E', '#7C90A3'],
}

// Secuencial (magnitud) de un solo tono, claro → oscuro (barras de tablas, etc.).
// Divergente (crecimiento / caída): verde ↔ rojo con punto medio gris neutro.
// Verde para crecer (el azul de marca se reserva para las series).
export const DIVERGING = {
  light: { pos: '#13A374', neg: '#E34948', mid: '#EFF2F5' },
  dark: { pos: '#34D3A0', neg: '#F27A6E', mid: '#1D3850' },
}

// Mapa de calor: azul medio (poco) → azul claro → crema neutro → naranja → rojo (mucho).
// Transición suave de dos tonos para que el ROJO sea el protagonista; el azul no llega a oscuro
// y no hay violeta. Solo el rojo final lleva texto blanco.
export const HEAT = ['#5b93cf', '#8cb5e0', '#bcd5ee', '#eef0ec', '#f8d3a8', '#f3a375', '#e5684d', '#cc3333']
export const heatIndex = (v: number, lo: number, hi: number) =>
  Math.max(0, Math.min(HEAT.length - 1, Math.round(((v - lo) / Math.max(hi - lo, 1e-9)) * (HEAT.length - 1))))
export const heatInk = (i: number) => (i >= 6 ? '#ffffff' : '#0b0b0b')

// Variación en 5 tramos (mapa de categorías): fácil de leer sin escala continua.
export const GROWTH_STEPS: { max: number; label: string; light: string; dark: string; ink: 'light' | 'dark' }[] = [
  { max: -10, label: 'Cae más de 10%', light: '#c8302f', dark: '#d65050', ink: 'light' },
  { max: -2, label: 'Cae 2–10%', light: '#f2a8a6', dark: '#7c3a3a', ink: 'dark' },
  { max: 2, label: 'Estable (±2%)', light: '#e4e2dc', dark: '#45443f', ink: 'dark' },
  { max: 10, label: 'Crece 2–10%', light: '#a3dbb0', dark: '#2e6b45', ink: 'dark' },
  { max: Infinity, label: 'Crece más de 10%', light: '#1f9d55', dark: '#2fb36a', ink: 'light' },
]
export const growthStep = (v: number | null | undefined) => GROWTH_STEPS.find((s) => (v ?? 0) <= s.max) ?? GROWTH_STEPS[2]

export interface ChartTokens {
  mode: Mode
  surface: string
  ink: string
  ink2: string
  muted: string
  grid: string
  axis: string
  tooltipBg: string
  tooltipBorder: string
  series: string[]
  compare: string
  pos: string
  neg: string
  mid: string
}

export function tokens(mode: Mode): ChartTokens {
  const light = mode === 'light'
  return {
    mode,
    surface: light ? '#ffffff' : '#0C2235',
    ink: light ? '#002D49' : '#EAF1F7',
    ink2: light ? '#5B6B7A' : '#A9BBCB',
    muted: '#8A97A3',
    grid: light ? '#E6E9EC' : '#1D3850',   // cuadrícula de la guía
    axis: light ? '#8A97A3' : '#7C90A3',   // ejes en #8A97A3
    tooltipBg: light ? '#ffffff' : '#10293F',
    tooltipBorder: light ? 'rgba(0,45,73,0.12)' : 'rgba(255,255,255,0.12)',
    series: CATEGORICAL[mode],
    compare: light ? '#B7C0CA' : '#4A6078', // periodo comparativo: gris recesivo
    pos: DIVERGING[mode].pos,
    neg: DIVERGING[mode].neg,
    mid: DIVERGING[mode].mid,
  }
}

/** Color estable por entidad (ej. sucursal): misma posición del catálogo = mismo color siempre. */
export function colorFor(entity: string, catalog: string[], mode: Mode): string {
  const i = catalog.indexOf(entity)
  const pal = CATEGORICAL[mode]
  return i >= 0 && i < pal.length ? pal[i] : mode === 'light' ? '#8A97A3' : '#7C90A3'
}
