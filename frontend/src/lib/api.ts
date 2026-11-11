import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

// La clave de acceso vive solo en sessionStorage (se borra al cerrar la pestaña) y viaja en X-API-Key.
const KEY = 'crm-api-key'
export const getKey = () => { try { return sessionStorage.getItem(KEY) ?? '' } catch { return '' } }
export const setKey = (k: string) => { try { k ? sessionStorage.setItem(KEY, k) : sessionStorage.removeItem(KEY) } catch { /* sin storage */ } }

export class ApiError extends Error {
  status: number
  codigo?: string
  constructor(message: string, status: number, codigo?: string) { super(message); this.status = status; this.codigo = codigo }
}

export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const headers: Record<string, string> = {}
  const key = getKey()
  if (key) headers['X-API-Key'] = key
  if (init.body !== undefined) headers['Content-Type'] = 'application/json'
  let r: Response
  try {
    r = await fetch(`/api${path}`, { method: init.method ?? 'GET', headers, body: init.body !== undefined ? JSON.stringify(init.body) : undefined })
  } catch {
    throw new ApiError('No hay conexión con el servidor del CRM.', 0)
  }
  if (r.status === 204) return undefined as T
  let data: unknown = null
  try { data = await r.json() } catch { /* cuerpo vacío */ }
  if (!r.ok) {
    const d = data as { detail?: unknown; codigo?: string } | null
    let msg = typeof d?.detail === 'string' ? d.detail : ''
    if (!msg && Array.isArray(d?.detail)) msg = 'Hay datos inválidos en el formulario.'
    throw new ApiError(msg || `Error ${r.status}`, r.status, d?.codigo)
  }
  return data as T
}

export const useGet = <T,>(path: string, opts: { enabled?: boolean; stale?: number } = {}) =>
  useQuery<T>({ queryKey: [path], queryFn: () => api<T>(path), enabled: opts.enabled ?? true, staleTime: opts.stale ?? 60_000, retry: false })

export const usePost = <T, B = unknown>(path: string) =>
  useMutation<T, ApiError, B>({ mutationFn: (body) => api<T>(path, { method: 'POST', body }) })

export function useInvalidate() {
  const qc = useQueryClient()
  return (prefix: string) => qc.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith(prefix) })
}

// ------------------------------------------------------------------------------------ tipos
export interface Producto {
  producto_id: string; ean?: string; producto: string; marca: string; tipo_producto?: string
  familia?: string; departamento?: string; grupo?: string; seccion?: string
  precio_venta: number; costo_ultima_compra?: number; stock_actual?: number
  ultima_venta?: string | null; unidades_90d?: number; venta_90d?: number; dias_sin_venta?: number | null
  cobertura_dias?: number | null; capital_inmovilizado?: number
  razon?: string; fuente?: string; causa?: string; descuento_sugerido?: number; margen_pct?: number; hist_unidades?: number
}
export interface Opcion { codigo: string; nombre: string; productos: number }
export interface Filtros { familias: Opcion[]; departamentos: Opcion[]; grupos: Opcion[]; secciones: Opcion[]; tipos: Opcion[]; marcas: Opcion[] }
export interface Temporada { id: string; nombre: string; inicio: string; fin: string; estado: string; dias_para_inicio: number; contexto: string; anticipacion: number }
export interface Textos {
  whatsapp?: { texto: string }; sms?: { texto: string }
  email?: { asunto: string; preheader?: string; cuerpo: string }
}
export interface Mensaje {
  modo: 'ia' | 'manual'; prompt: string; tono: string; canales: string[]; textos: Textos; tokens: number; temporada_id?: string | null
}
export interface Campana {
  id: string; nombre: string; objetivo: string; estado: 'borrador' | 'publicada'; paso: number
  productos: Producto[]; mensaje: Partial<Mensaje>; segmentacion: { filtros?: Record<string, unknown> }
  audiencia: number; costo_estimado: number; creada: string; actualizada: string; publicada_en: string | null
  n_productos?: number
}
export interface Resumen {
  base_clientes: number; audiencia_candidata: number; audiencia: number; por_canal: Record<string, number>
  costo_estimado: number; costo_por_contacto: number; puntaje_promedio: number
  segmentos_rfm: { id: string; nombre: string; n: number }[]; sexo: { id: string; n: number }[]
  edades: { id: string; n: number }[]; ciclo: { id: string; nombre: string; n: number }[]; ciudades: { id: string; n: number }[]
  curva: { pct_audiencia: number; pct_potencial: number; contactos: number; puntaje_corte: number }[]
  corte_recomendado: { contactos: number; pct_audiencia: number; pct_potencial: number; puntaje_minimo: number } | null
}
export interface Preview {
  resumen: Resumen
  muestra: { cliente: string; celular: string; correo: string; puntaje: number; afinidad: number; segmento: string; canales: string[]; motivos: string[] }[]
  restricciones: { alcohol_o_tabaco: string[]; excluye_menores: boolean; excluidos_por_campana_reciente: number }
}
export interface OpcionesSeg {
  segmentos_rfm: Record<string, string>; ciclo: Record<string, string>; edades: string[]; clubs: string[]
  objetivos: Record<string, string>; costos: Record<string, number>; canales: string[]
}
export interface Estado {
  datos: boolean; ia: boolean; zona: string; modo: string
  etl: { corriendo: boolean; mensaje: string; error: string | null }
  warehouse?: { fecha_min: string; fecha_max: string; construido: string; clientes: number; clientes_con_compras: number; productos: number; lineas_venta: number }
}
