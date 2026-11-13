import type { DatosCliente } from './modelo'

// ------------------------------------------------------------------------------------------ validadores (los mismos del servidor)
/** Celular colombiano: 10 dígitos que empiezan por 3 (acepta prefijo +57). Devuelve solo los dígitos o null. */
export function celularValido(v: string): string | null {
  const d = (v ?? '').replace(/\D/g, '').replace(/^57(?=3\d{9}$)/, '')
  return /^3\d{9}$/.test(d) ? d : null
}
export const emailValido = (v: string) => /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test((v ?? '').trim()) && !(v ?? '').trim().toLowerCase().startsWith('facturaelectronica')
/** CEDCLI en el ERP mide 10 caracteres. */
export const documentoValido = (v: string) => /^\d{5,10}$/.test(v.trim())

export function errorCelular(v: string): string | null {
  if (!v.trim()) return null
  return celularValido(v) ? null : 'Debe tener 10 dígitos y empezar por 3 (ej. 3101234567).'
}
export function errorEmail(v: string): string | null {
  if (!v.trim()) return null
  if (v.trim().length > 50) return 'Máximo 50 caracteres (límite de la columna EMAIL del ERP).'
  return /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(v.trim()) ? null : 'El correo no parece válido (ej. nombre@dominio.com).'
}
export function errorNacimiento(v: string | null): string | null {
  if (!v) return null
  const d = new Date(v + 'T00:00:00')
  if (Number.isNaN(d.getTime())) return 'Fecha no válida.'
  const edad = (Date.now() - d.getTime()) / 31_557_600_000
  if (edad < 0) return 'La fecha de nacimiento no puede ser futura.'
  if (edad > 110) return 'Revise la fecha: la edad supera los 110 años.'
  return null
}
export function errorNombre(v: string, obligatorio: boolean): string | null {
  const t = v.trim()
  if (obligatorio && t.length < 2) return 'Obligatorio (mínimo 2 letras).'
  if (t && !/^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ' .-]+$/.test(t)) return 'Solo letras, espacios, punto o guion.'
  if (t.length > 50) return 'Máximo 50 caracteres.'
  return null
}
export const edadDe = (nac: string | null): number | null => {
  if (!nac) return null
  const d = new Date(nac + 'T00:00:00')
  return Number.isNaN(d.getTime()) ? null : Math.floor((Date.now() - d.getTime()) / 31_557_600_000)
}

// ------------------------------------------------------------------------------------------ completitud (mismos pesos que el servidor)
type Evaluable = Pick<DatosCliente, 'nombre1' | 'apellido1' | 'celular' | 'email' | 'consentimiento' | 'nacimiento' | 'ciudadId' | 'barrioId' | 'direccion' | 'sexo'> & { cumple?: string | null }
export interface Faltante { campo: string; etiqueta: string; peso: number }

const REGLAS: { campo: string; etiqueta: string; peso: number; ok: (c: Evaluable) => number }[] = [
  { campo: 'nombres', etiqueta: 'Nombre y apellido', peso: 15, ok: (c) => (c.nombre1.trim().length > 1 && c.apellido1.trim().length > 1 ? 15 : 0) },
  { campo: 'celular', etiqueta: 'Celular válido', peso: 20, ok: (c) => (celularValido(c.celular) ? 20 : 0) },
  { campo: 'email', etiqueta: 'Correo válido', peso: 15, ok: (c) => (emailValido(c.email) ? 15 : 0) },
  { campo: 'consentimiento', etiqueta: 'Consentimiento registrado', peso: 15, ok: (c) => (c.consentimiento !== 'sin_registro' ? 15 : 0) },
  { campo: 'nacimiento', etiqueta: 'Fecha de nacimiento', peso: 10, ok: (c) => (c.nacimiento ? 10 : c.cumple ? 5 : 0) },
  { campo: 'ciudadId', etiqueta: 'Ciudad', peso: 10, ok: (c) => (c.ciudadId ? 10 : 0) },
  { campo: 'barrioId', etiqueta: 'Barrio', peso: 5, ok: (c) => (c.barrioId ? 5 : 0) },
  { campo: 'direccion', etiqueta: 'Dirección', peso: 5, ok: (c) => (c.direccion.trim().length > 4 ? 5 : 0) },
  { campo: 'sexo', etiqueta: 'Género', peso: 5, ok: (c) => (c.sexo !== 'N' ? 5 : 0) },
]

/** Puntaje 0–100 de qué tan completa y utilizable está la ficha. */
export const completitud = (c: Evaluable) => REGLAS.reduce((a, r) => a + r.ok(c), 0)
export const faltantes = (c: Evaluable): Faltante[] => REGLAS.filter((r) => r.ok(c) < r.peso).map((r) => ({ campo: r.campo, etiqueta: r.etiqueta, peso: r.peso - r.ok(c) }))

/** ¿Se le puede escribir por este canal? Autorización general (Ley 1581) + dato válido + el canal no fue negado expresamente. */
export const contactable = (c: Pick<DatosCliente, 'consentimiento' | 'celular' | 'email' | 'autorizaSms' | 'autorizaEmail' | 'autorizaWhatsapp'>) => ({
  whatsapp: c.consentimiento === 'si' && !!celularValido(c.celular) && c.autorizaWhatsapp !== false,
  sms: c.consentimiento === 'si' && !!celularValido(c.celular) && c.autorizaSms !== false,
  email: c.consentimiento === 'si' && emailValido(c.email) && c.autorizaEmail !== false,
})

// ------------------------------------------------------------------------------------------ problemas de calidad (el conteo lo hace el servidor)
export interface Problema { id: string; titulo: string; ayuda: string; gravedad: 'alta' | 'media' | 'baja' }
export const PROBLEMAS: Problema[] = [
  { id: 'sin_celular', titulo: 'Sin celular válido', ayuda: 'No se les puede escribir por WhatsApp ni SMS.', gravedad: 'alta' },
  { id: 'sin_consentimiento', titulo: 'Sin consentimiento registrado', ayuda: 'No se pueden contactar con la política estricta (Ley 1581).', gravedad: 'alta' },
  { id: 'sin_email', titulo: 'Sin correo válido', ayuda: 'El canal más barato queda cerrado.', gravedad: 'media' },
  { id: 'sin_nacimiento', titulo: 'Sin fecha de nacimiento', ayuda: 'No hay cumpleaños y se excluyen de productos restringidos.', gravedad: 'media' },
  { id: 'nombre_corto', titulo: 'Nombre incompleto o sospechoso', ayuda: 'Nombre o apellido vacío, de una letra o con números.', gravedad: 'media' },
  { id: 'sin_ubicacion', titulo: 'Sin ciudad o barrio', ayuda: 'No se puede segmentar por zona.', gravedad: 'baja' },
]

/** Campos de la ficha que cambiaron (lo único que viaja al servidor al guardar). */
export function diferencias(antes: DatosCliente, despues: DatosCliente): Partial<DatosCliente> {
  const out: Record<string, unknown> = {}
  for (const k of Object.keys(despues) as (keyof DatosCliente)[]) {
    if (k === 'documento' || k === 'departamentoId') continue
    if (JSON.stringify(antes[k] ?? null) !== JSON.stringify(despues[k] ?? null)) out[k] = despues[k]
  }
  return out as Partial<DatosCliente>
}
