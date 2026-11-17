import type { Mensaje, Producto } from './api'

export interface Chequeo { ok: boolean; texto: string; ayuda?: string }

const VIGENCIA = /\{vigencia\}/i
const LEYENDA = /(exceso\s+de\s+alcohol|perjudicial\s+para\s+la\s+salud|prohibido.*menores|menores\s+de\s+edad)/i
const NO_GSM = /[áíóúÁÍÓÚ]|\p{Extended_Pictographic}/u

/**
 * Lista de verificación de calidad del mensaje (marketing + cumplimiento). Son recomendaciones, no bloquean la
 * publicación: la persona decide. `restringido` = hay licor o tabaco entre los productos.
 */
export function revisarCalidad(m: Partial<Mensaje>, productos: Producto[], restringido = false): Chequeo[] {
  const out: Chequeo[] = []
  const canales = m.canales ?? []
  const t = m.textos ?? {}
  const wa = t.whatsapp?.texto ?? '', sms = t.sms?.texto ?? '', em = t.email
  const todos = [wa, sms, em?.cuerpo ?? ''].join('\n')

  // Vigencia: cada canal debe decir hasta cuándo vale la oferta. {vigencia} se reemplaza por las fechas reales al publicar.
  for (const [canal, id, texto] of [['WhatsApp', 'whatsapp', wa], ['SMS', 'sms', sms], ['Correo', 'email', em?.cuerpo ?? '']] as const) {
    if (!canales.includes(id) || !texto) continue
    out.push({ ok: VIGENCIA.test(texto), texto: `${canal}: indica la vigencia`, ayuda: 'Incluya «Válido {vigencia}»: se reemplaza por las fechas que elija al publicar (p. ej. «del 22 al 24 de noviembre»).' })
  }
  if (canales.includes('sms') && sms) {
    const un = sms.length <= 160 && !NO_GSM.test(sms)
    out.push({ ok: un, texto: 'SMS: cabe en un solo mensaje', ayuda: 'Más de 160 caracteres, o tildes y emojis, hacen que se envíen (y cobren) varios SMS.' })
  }
  if (canales.includes('email') && em) {
    const largo = (em.asunto ?? '').length
    out.push({ ok: largo > 0 && largo <= 60, texto: 'Correo: asunto de máximo 60 caracteres', ayuda: 'Los asuntos largos se cortan en el celular.' })
    out.push({ ok: Boolean(em.preheader?.trim()), texto: 'Correo: texto de vista previa', ayuda: 'Es la segunda línea que se ve en la bandeja; aumenta la apertura.' })
    const letras = (em.asunto ?? '').replace(/[^A-Za-zÁÉÍÓÚÑáéíóúñ]/g, '')
    out.push({ ok: !(letras.length > 8 && letras === letras.toUpperCase()), texto: 'Correo: asunto sin gritar (todo en mayúsculas)', ayuda: 'Las mayúsculas sostenidas activan filtros de spam.' })
  }
  if (todos.trim()) {
    out.push({ ok: /\{nombre\}/i.test(todos), texto: 'Personalizado con el nombre del cliente', ayuda: 'Use {nombre}: los mensajes personalizados convierten más.' })
    const sinPrecio = productos.filter((p) => !(p.precio_venta > 0)).length
    if (productos.length && sinPrecio < productos.length) out.push({ ok: /\$\s?\d/.test(todos), texto: 'Menciona un precio u oferta concreta', ayuda: 'Un beneficio claro (precio, 2x1, % de descuento) da una razón para actuar.' })
  }
  if (restringido && todos.trim()) {
    out.push({ ok: LEYENDA.test(todos), texto: 'Leyenda de venta restringida (licor/tabaco)', ayuda: 'Incluya p. ej. «El exceso de alcohol es perjudicial para la salud. Prohibido a menores de edad». Confírmelo con su asesor legal.' })
  }
  return out
}

/** Porcentaje de chequeos cumplidos (0–100). */
export const puntajeCalidad = (c: Chequeo[]) => (c.length ? Math.round((100 * c.filter((x) => x.ok).length) / c.length) : 0)
