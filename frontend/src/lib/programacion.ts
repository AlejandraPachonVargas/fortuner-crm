import type { Momento } from './api'
import { DIAS } from './format'

const pad = (n: number) => String(n).padStart(2, '0')
export const fechaISO = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
/** Valor que entiende el servidor: hora local sin zona (`2026-11-14T16:30`). */
export const aLocalISO = (fecha: string, hora: string) => `${fecha}T${hora}`
export const aDate = (fecha: string, hora: string) => new Date(`${fecha}T${hora}:00`)

/** Hora de envío sugerida según la franja en que más compra la audiencia: llegar justo antes de su momento de compra. */
const HORA_POR_FRANJA: Record<string, string> = { mañana: '08:30', tarde: '12:30', noche: '16:30' }

export interface Sugerencia { fecha: string; hora: string; etiqueta: string; motivo: string }

/** Próxima fecha (≥ `ahora` + 30 min) en que cae el día ISO `dia` (1=lunes…7=domingo) a la hora `hora`. */
export function proximoDia(dia: number, hora: string, ahora: Date): string {
  const [h, m] = hora.split(':').map(Number)
  for (let i = 0; i < 8; i++) {
    const d = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate() + i, h, m)
    const iso = d.getDay() === 0 ? 7 : d.getDay()
    if (iso === dia && d.getTime() >= ahora.getTime() + 30 * 60_000) return fechaISO(d)
  }
  return fechaISO(ahora)
}

export function sugerirMomento(m: Momento | undefined, ahora: Date = new Date()): Sugerencia | null {
  if (!m || !m.mejor_dia || !m.mejor_franja) return null
  const dia = m.mejor_dia
  let hora = HORA_POR_FRANJA[m.mejor_franja] ?? '10:00'
  if (dia >= 6 && hora > '12:00') hora = '12:00' // fin de semana: el SMS comercial solo se permite hasta las 15:00
  const fecha = proximoDia(dia, hora, ahora)
  const total = m.dias.reduce((a, d) => a + d.n, 0) || 1
  const pct = Math.round((100 * (m.dias.find((d) => d.id === dia)?.n ?? 0)) / total)
  return { fecha, hora, etiqueta: `${DIAS[dia]} ${fmtHora(hora)}`,
    motivo: `${pct}% de esta audiencia suele comprar los ${DIAS[dia].toLowerCase()}, sobre todo en la ${m.mejor_franja}. Se sugiere enviar poco antes.` }
}

export function fmtHora(hora: string): string {
  const [h, m] = hora.split(':').map(Number)
  return `${h % 12 || 12}:${pad(m)} ${h < 12 ? 'a. m.' : 'p. m.'}`
}

/** «vie 14 nov · 4:30 p. m.» a partir de `2026-11-14T16:30:00`. */
export function fmtProgramada(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const f = d.toLocaleDateString('es-CO', { weekday: 'short', day: '2-digit', month: 'short' }).replace(/\./g, '')
  return `${f} · ${fmtHora(`${pad(d.getHours())}:${pad(d.getMinutes())}`)}`
}

/** Espejo de la validación del servidor (CRC 5111/2017 para SMS comercial). Son avisos, no bloqueos. */
export function avisosHorario(d: Date, canales: string[]): string[] {
  const out: string[] = []
  const finSemana = d.getDay() === 0 || d.getDay() === 6
  if (canales.includes('sms')) {
    const [ini, fin] = finSemana ? [8, 15] : [7, 19]
    if (d.getHours() < ini || d.getHours() >= fin) out.push(`El SMS comercial solo debe enviarse entre ${ini}:00 y ${fin}:00 ese día (CRC 5111/2017; los festivos cuentan como fin de semana).`)
  }
  if (d.getHours() < 6 || d.getHours() >= 22) out.push('Es una hora poco habitual para que el cliente lea el mensaje: considere una franja de día.')
  return out
}

/** Error de validación (vacío = fecha válida para programar). */
export function errorFecha(fecha: string, hora: string, ahora: Date = new Date()): string | null {
  if (!fecha || !hora) return 'Elija la fecha y la hora.'
  const d = aDate(fecha, hora)
  if (Number.isNaN(d.getTime())) return 'La fecha u hora no es válida.'
  if (d.getTime() < ahora.getTime() + 2 * 60_000) return 'La hora debe estar en el futuro (al menos 2 minutos desde ahora).'
  if (d.getTime() > ahora.getTime() + 365 * 86_400_000) return 'No se puede programar con más de un año de anticipación.'
  return null
}
