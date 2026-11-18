import { useQueryClient } from '@tanstack/react-query'
import { Cake, HeartHandshake, ShoppingBag, UserPlus, type LucideIcon } from 'lucide-react'
import { api, useGet, type Producto, type Textos } from '@/lib/api'

export type TipoId = 'cumpleanos' | 'bienvenida' | 'segunda_compra' | 'reactivacion'
export type TipoOferta = 'descuento_pct' | 'descuento_valor' | 'producto' | 'regalo' | 'otro'

export interface Oferta { tipo: TipoOferta; valor: number | null; descripcion: string; productos: Producto[]; restringido: boolean }
export interface Edicion {
  id: string; automatizacion_id: string; nombre: string; desde: string; hasta: string; oferta: Oferta; validez_dias: number
  canales: string[]; textos: Textos; problemas: string[]
}
export interface Ejecucion {
  id: string; fecha: string; inicio: string; fin: string | null; origen: string; estado: 'ok' | 'sin_edicion' | 'incompleta' | 'error'
  edicion_id: string | null; candidatos: number; enviados: number; costo: number
  detalle: { excluidos?: Record<string, number>; por_canal?: Record<string, number>; aviso?: string; dias?: string[] }
}
export interface ResumenEnvios {
  dias: number; envios: number; personas: number; costo: number; total_historico: number
  por_dia: { fecha: string; n: number }[]; por_canal: Record<string, number>
}
export interface Automatizacion {
  id: string; tipo: TipoId; tipo_nombre: string; disparo: string; nombre: string; activa: boolean; hora: string
  params: Record<string, number>; filtros: { clubes: string[]; segmentos: string[] }
  creada: string; actualizada: string; activada_en: string | null; ultima_ref: string | null
  ediciones: Edicion[]; vigente: string | null; proxima_edicion: string | null; proxima_ejecucion: string | null
  ultima: Ejecucion | null; envios: ResumenEnvios; ejecuciones?: Ejecucion[]
}
export interface ParamDef { clave: string; label: string; min: number; max: number; defecto: number; unidad: string; ayuda: string; paso: number }
export interface TipoAuto { id: TipoId; nombre: string; descripcion: string; disparo: string; params: ParamDef[] }
export interface Catalogo { tipos: TipoAuto[]; ofertas: Record<TipoOferta, string>; motivos: Record<string, string> }
export interface Prueba {
  fecha: string; estado: 'ok' | 'sin_edicion' | 'incompleta'; aviso?: string; probar: boolean
  edicion: { id: string; nombre: string; oferta: string; validez_dias: number } | null
  dias?: string[]; candidatos?: number; elegibles?: number; enviados?: number; excluidos?: Record<string, number>
  por_canal?: Record<string, number>; costo?: number; excluye_menores?: boolean; vigencia_desde?: string; vigencia_hasta?: string
  muestra?: { cliente: string; canales: string[] }[]
}

export const ICONOS: Record<TipoId, LucideIcon> = { cumpleanos: Cake, bienvenida: UserPlus, segunda_compra: ShoppingBag, reactivacion: HeartHandshake }
export const TONOS: Record<TipoId, string> = {
  cumpleanos: 'bg-[#fdebd8] text-[#b45a0b]', bienvenida: 'bg-[#dcf8e6] text-[#128c4a]',
  segunda_compra: 'bg-[#e3eefc] text-[#0F70FC]', reactivacion: 'bg-[#efe7fd] text-[#5B5FF7]',
}

export const useAutos = () => useGet<{ items: Automatizacion[]; resumen: ResumenEnvios }>('/automatizaciones', { stale: 15_000 })
export const useAuto = (id: string | undefined) => useGet<Automatizacion>(`/automatizaciones/${id}`, { enabled: !!id, stale: 10_000 })
export const useCatalogo = () => useGet<Catalogo>('/automatizaciones/tipos', { stale: 3_600_000 })

/** Llama a la API y refresca todo lo de Automatizaciones (lista, detalle) al terminar. */
export function useAccion() {
  const qc = useQueryClient()
  return async <T,>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> => {
    const r = await api<T>(path, init)
    await qc.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith('/automatizaciones') })
    return r
  }
}

/** Estado de una edición respecto a hoy. */
export function estadoEdicion(e: Edicion, hoy: string): 'vigente' | 'proxima' | 'pasada' {
  return e.hasta < hoy ? 'pasada' : e.desde > hoy ? 'proxima' : 'vigente'
}

export const ORIGEN = (o: string) => (o === 'planificador' ? 'Automática' : 'Manual')
/** «El día del cumpleaños, según… del ERP» → «el día del cumpleaños, según… del ERP» (solo la primera letra). */
export const enFrase = (s: string) => (s ? s[0].toLowerCase() + s.slice(1) : s)
