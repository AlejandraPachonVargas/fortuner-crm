import { describe, expect, it } from 'vitest'
import { VACIO } from './FormCliente'
import { parsear } from './ImportarDialog'
import type { DatosCliente } from './modelo'
import { celularValido, completitud, contactable, diferencias, documentoValido, emailValido, errorEmail, errorNacimiento, errorNombre, faltantes } from './validacion'

const base = (): DatosCliente => ({
  ...VACIO, documento: '1053800123', nombre1: 'ANA', apellido1: 'PEREZ', sexo: 'F', nacimiento: '1990-05-01', celular: '3101234567', email: 'ana@correo.com',
  ciudadId: '17001', barrioId: '185', direccion: 'Cra 1 # 2-3', consentimiento: 'si',
})

describe('validadores (mismas reglas que el servidor)', () => {
  it('celular colombiano', () => {
    expect(celularValido('310 123 4567')).toBe('3101234567')
    expect(celularValido('+57 3101234567')).toBe('3101234567')
    expect(celularValido('6011234567')).toBeNull()
    expect(celularValido('8879020')).toBeNull()
  })
  it('correo: formato, genéricos de factura electrónica y largo de la columna EMAIL (50)', () => {
    expect(emailValido('a@b.co')).toBe(true)
    expect(emailValido('a@b')).toBe(false)
    expect(emailValido('facturaelectronicapos@mercaldas.com')).toBe(false)
    expect(errorEmail('x'.repeat(45) + '@correo.com')).toMatch(/50/)
  })
  it('documento cabe en CEDCLI (10) y nombres con letras', () => {
    expect(documentoValido('1053800123')).toBe(true)
    expect(documentoValido('12345678901')).toBe(false)
    expect(errorNombre('', true)).toMatch(/Obligatorio/)
    expect(errorNombre('ANA3', false)).toMatch(/letras/)
    expect(errorNombre('MARÍA JOSÉ', true)).toBeNull()
  })
  it('fecha de nacimiento', () => {
    expect(errorNacimiento('2999-01-01')).toMatch(/futura/)
    expect(errorNacimiento('1800-01-01')).toMatch(/110/)
    expect(errorNacimiento('1990-01-01')).toBeNull()
  })
})

describe('completitud y contacto', () => {
  it('ficha completa vale 100, sin celular pierde 20 y con solo el cumpleaños suma 5', () => {
    expect(completitud(base())).toBe(100)
    expect(completitud({ ...base(), celular: '' })).toBe(80)
    expect(faltantes({ ...base(), celular: '' }).map((f) => f.campo)).toEqual(['celular'])
    expect(completitud({ ...base(), nacimiento: null, cumple: '05-01' })).toBe(95)
  })
  it('sin consentimiento no se contacta; un canal negado expresamente tampoco', () => {
    expect(contactable({ ...base(), consentimiento: 'sin_registro' })).toEqual({ whatsapp: false, sms: false, email: false })
    expect(contactable(base()).whatsapp).toBe(true)
    expect(contactable({ ...base(), autorizaWhatsapp: false }).whatsapp).toBe(false)
    expect(contactable({ ...base(), autorizaWhatsapp: null }).whatsapp).toBe(true)
  })
})

describe('edición', () => {
  it('solo viajan al servidor los campos que cambiaron; nunca el documento', () => {
    const a = base()
    expect(diferencias(a, { ...a, celular: '3150000000', documento: '999' })).toEqual({ celular: '3150000000' })
    expect(diferencias(a, { ...a, etiquetas: ['VIP'] })).toEqual({ etiquetas: ['VIP'] })
    expect(diferencias(a, { ...a })).toEqual({})
  })
})

describe('importación', () => {
  it('lee CSV con comillas, punto y coma y BOM', () => {
    expect(parsear('﻿Documento;Nombres\n"123";"Ana; María"\n')).toEqual([{ documento: '123', nombres: 'Ana; María' }])
    expect(parsear('documento,nombres\n')).toEqual([])
  })
})
