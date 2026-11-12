import { describe, expect, it } from 'vitest'
import type { Momento, Producto } from './api'
import { revisarCalidad, puntajeCalidad } from './calidad'
import { avisosHorario, errorFecha, fmtHora, proximoDia, sugerirMomento } from './programacion'

// Jueves 12 de noviembre de 2026, 10:00
const AHORA = new Date(2026, 10, 12, 10, 0)

const momento = (dia: number, franja: string): Momento => ({
  dias: [1, 2, 3, 4, 5, 6, 7].map((id) => ({ id, n: id === dia ? 60 : 5 })),
  franjas: [{ id: franja, n: 10 }], mejor_dia: dia, mejor_franja: franja,
})

describe('programación', () => {
  it('encuentra el próximo día pedido, nunca en el pasado', () => {
    expect(proximoDia(5, '16:30', AHORA)).toBe('2026-11-13')   // viernes
    expect(proximoDia(4, '16:30', AHORA)).toBe('2026-11-12')   // hoy jueves, aún a tiempo
    expect(proximoDia(4, '09:00', AHORA)).toBe('2026-11-19')   // hoy ya pasó → próximo jueves
  })

  it('sugiere el mejor día con hora justo antes de su franja habitual', () => {
    const s = sugerirMomento(momento(5, 'noche'), AHORA)!
    expect(s.fecha).toBe('2026-11-13')
    expect(s.hora).toBe('16:30')
    expect(s.etiqueta).toContain('Viernes')
    expect(s.motivo).toContain('noche')
  })

  it('en fin de semana limita la hora al horario permitido para SMS', () => {
    expect(sugerirMomento(momento(6, 'noche'), AHORA)!.hora).toBe('12:00')
    expect(sugerirMomento(undefined, AHORA)).toBeNull()
  })

  it('valida la fecha elegida', () => {
    expect(errorFecha('', '')).toBeTruthy()
    expect(errorFecha('2026-11-12', '10:01', AHORA)).toMatch(/futuro/)
    expect(errorFecha('2026-11-12', '11:00', AHORA)).toBeNull()
    expect(errorFecha('2028-01-01', '10:00', AHORA)).toMatch(/año/)
  })

  it('avisa del horario de SMS comercial (CRC) igual que el servidor', () => {
    expect(avisosHorario(new Date(2026, 10, 13, 10, 0), ['sms'])).toEqual([])          // viernes 10:00
    expect(avisosHorario(new Date(2026, 10, 13, 20, 0), ['sms']).length).toBe(1)         // viernes 20:00: fuera de 7–19
    expect(avisosHorario(new Date(2026, 10, 13, 23, 0), ['sms']).length).toBe(2)         // + hora poco habitual
    expect(avisosHorario(new Date(2026, 10, 14, 16, 0), ['sms']).length).toBe(1)         // sábado 16:00
    expect(avisosHorario(new Date(2026, 10, 14, 16, 0), ['email'])).toEqual([])
  })

  it('formatea la hora en 12 h', () => {
    expect(fmtHora('16:30')).toBe('4:30 p. m.')
    expect(fmtHora('00:05')).toBe('12:05 a. m.')
  })
})

describe('calidad del mensaje', () => {
  const prod = [{ producto_id: '1', producto: 'RON', marca: 'X', precio_venta: 50000 }] as Producto[]

  it('marca como pendiente lo que falta y puntúa', () => {
    const c = revisarCalidad({ canales: ['sms'], textos: { sms: { texto: 'Hola con tildes ¡qué día! Llévalo YA por $50.000 en tienda' } } }, prod)
    expect(c.find((x) => x.texto.includes('opción de baja'))!.ok).toBe(false)
    expect(c.find((x) => x.texto.includes('un solo mensaje'))!.ok).toBe(false)   // tildes → Unicode
    expect(puntajeCalidad(c)).toBeLessThan(60)
  })

  it('un SMS completo pasa todo', () => {
    const c = revisarCalidad({ canales: ['sms'], textos: { sms: { texto: 'Hola {nombre}, 2x1 en ron $50.000 hoy. Responde NO para dejar de recibir' } } }, prod)
    expect(c.every((x) => x.ok)).toBe(true)
    expect(puntajeCalidad(c)).toBe(100)
  })

  it('exige la leyenda sanitaria cuando hay licor', () => {
    const base = { canales: ['whatsapp'], textos: { whatsapp: { texto: 'Hola {nombre} ron $50.000. Responde NO para dejar de recibir' } } }
    expect(revisarCalidad(base, prod, true).find((x) => x.texto.includes('Leyenda'))!.ok).toBe(false)
    const con = { ...base, textos: { whatsapp: { texto: base.textos.whatsapp.texto + ' El exceso de alcohol es perjudicial para la salud.' } } }
    expect(revisarCalidad(con, prod, true).find((x) => x.texto.includes('Leyenda'))!.ok).toBe(true)
  })

  it('detecta asunto largo o gritado en el correo', () => {
    const c = revisarCalidad({ canales: ['email'], textos: { email: { asunto: 'GRAN OFERTA SOLO HOY EN LICORES', cuerpo: 'x' } } }, prod)
    expect(c.find((x) => x.texto.includes('sin gritar'))!.ok).toBe(false)
    expect(c.find((x) => x.texto.includes('vista previa'))!.ok).toBe(false)
  })
})
