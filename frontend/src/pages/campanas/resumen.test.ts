import { describe, expect, it } from 'vitest'
import { fmtCop, fmtCopCorto } from '@/lib/format'
import { filtrosActivos, pendientes, type DatosCampana } from './ResumenCampana'

const base: DatosCampana = {
  nombre: 'Feria', objetivo: '', filtros: {}, audiencia: 0, costo: 0,
  productos: [{ producto_id: '1', producto: 'RON', marca: 'X', precio_venta: 50000 }],
  mensaje: { canales: ['sms'], textos: { sms: { texto: 'Hola {nombre}' } } },
}

describe('pendientes', () => {
  it('no marca nada cuando la campaña está completa', () => {
    expect(pendientes(base)).toEqual([])
  })
  it('exige nombre, productos y texto de cada canal elegido', () => {
    const p = pendientes({ ...base, nombre: ' ', productos: [], mensaje: { canales: ['sms', 'email'], textos: { sms: { texto: '' } } } })
    expect(p).toContain('Falta el nombre de la campaña.')
    expect(p).toContain('Seleccione al menos un producto.')
    expect(p).toContain('Falta el mensaje de SMS.')
    expect(p).toContain('Falta el mensaje de Correo.')
  })
  it('el correo necesita asunto y cuerpo', () => {
    const d = { ...base, mensaje: { canales: ['email'], textos: { email: { asunto: '', cuerpo: 'algo' } } } }
    expect(pendientes(d)).toContain('Falta el mensaje de Correo.')
  })
  it('avisa si la audiencia quedó vacía', () => {
    const preview = { resumen: { audiencia: 0 } } as unknown as DatosCampana['preview']
    expect(pendientes({ ...base, preview })).toContain('La segmentación no deja ningún destinatario.')
  })
})

describe('filtrosActivos', () => {
  it('ignora vacíos y traduce los días', () => {
    const r = filtrosActivos({ sexo: ['F'], dias_pref: [1, 5], edades: [], min_visitas: '', afinidad_minima: 0, tope_contactos: 5000 })
    expect(r).toEqual([
      { k: 'Género', v: 'F' }, { k: 'Día de compra', v: 'Lun, Vie' }, { k: 'Tope de personas', v: '5000' },
    ])
  })
})

describe('formatos', () => {
  it('formatea pesos colombianos', () => {
    expect(fmtCop(1234567)).toMatch(/1\.234\.567/)
    expect(fmtCop(null)).toBe('—')
  })
  it('abrevia montos', () => {
    expect(fmtCopCorto(2_500_000)).toBe('$2,5 millones')
    expect(fmtCopCorto(33_540_000_000)).toBe('$33.540 millones')   // nunca «mil M»
    expect(fmtCopCorto(450_000)).toContain('mil')
  })
})
