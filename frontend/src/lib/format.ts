const cop = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 })
const nf = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 })
const nf1 = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 1 })

export const fmtCop = (v: number | null | undefined) => (v == null ? '—' : cop.format(v))
export const fmtNum = (v: number | null | undefined) => (v == null ? '—' : nf.format(v))
export const fmtNum1 = (v: number | null | undefined) => (v == null ? '—' : nf1.format(v))
export const fmtPct = (v: number | null | undefined) => (v == null ? '—' : `${nf1.format(v)}%`)

/** $ abreviado para tarjetas: 1,2 M / 450 mil. */
export function fmtCopCorto(v: number | null | undefined): string {
  if (v == null) return '—'
  const a = Math.abs(v)
  if (a >= 1e9) return `$${nf1.format(v / 1e9)} mil M`
  if (a >= 1e6) return `$${nf1.format(v / 1e6)} M`
  if (a >= 1e3) return `$${nf.format(v / 1e3)} mil`
  return `$${nf.format(v)}`
}

export function fmtFecha(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' })
}

export function fmtFechaHora(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('es-CO', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}

export const CANAL_LABEL: Record<string, string> = { whatsapp: 'WhatsApp', sms: 'SMS', email: 'Correo' }
export const DIAS = ['', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo']
