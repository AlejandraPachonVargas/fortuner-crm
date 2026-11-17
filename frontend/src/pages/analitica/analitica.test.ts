import { describe, expect, it } from 'vitest'
import { esc, fmtV, safeColor } from '@/charts/builders'
import { diasHastaFinDeMes } from '../campanas/PanelPublicacion'
import { celdaCsv, consulta } from './kit'

describe('exportación CSV', () => {
  it('neutraliza fórmulas (inyección en Excel)', () => {
    expect(celdaCsv('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`)
    expect(celdaCsv('+57 300')).toBe(`"'+57 300"`)
    expect(celdaCsv('-1')).toBe(`"'-1"`)
    expect(celdaCsv('@SUM(A1)')).toBe(`"'@SUM(A1)"`)
    expect(celdaCsv('Club del Vino')).toBe('"Club del Vino"')
    expect(celdaCsv(12.5)).toBe('12,5')
    expect(celdaCsv(null)).toBe('""')
  })
})

describe('filtros en la URL de la API', () => {
  it('solo incluye los filtros con valor', () => {
    expect(consulta({ clubes: ['1', '2'], sexos: [], desde: '' })).toBe('?clubes=1%2C2')
    expect(consulta({})).toBe('')
  })
})

describe('gráficas', () => {
  it('escapa el texto que va al HTML del tooltip', () => {
    expect(esc('<img src=x onerror=alert(1)>')).toBe('&lt;img src=x onerror=alert(1)&gt;')
    expect(safeColor('red;background:url(x)')).toBe('#8A97A3')
    expect(safeColor('#1c5cab')).toBe('#1c5cab')
  })
  it('abrevia las cifras en los ejes', () => {
    expect(fmtV(1_500_000, 'int')).toBe('1,5 M')
    expect(fmtV(25_300, 'int')).toBe('25,3 mil')
    expect(fmtV(null, 'int')).toBe('—')
  })
})

describe('vigencia hasta fin de mes', () => {
  it('cuenta los días restantes del mes, ambos incluidos', () => {
    expect(diasHastaFinDeMes('2026-12-01')).toBe(31)
    expect(diasHastaFinDeMes('2026-11-22')).toBe(9)
    expect(diasHastaFinDeMes('2028-02-01')).toBe(29)
    expect(diasHastaFinDeMes('2026-12-31')).toBe(1)
  })
})
