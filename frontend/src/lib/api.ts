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

// Nombre con el que se firman los cambios en la auditoría de Clientes 360° (cada persona escribe el suyo).
const USUARIO = 'crm-usuario'
export const getUsuario = () => { try { return localStorage.getItem(USUARIO) ?? '' } catch { return '' } }
export const setUsuario = (u: string) => { try { u ? localStorage.setItem(USUARIO, u.slice(0, 30)) : localStorage.removeItem(USUARIO) } catch { /* sin storage */ } }

function cabeceras(conCuerpo: boolean): Record<string, string> {
  const headers: Record<string, string> = {}
  const key = getKey()
  if (key) headers['X-API-Key'] = key
  const u = getUsuario()
  if (u) headers['X-CRM-Usuario'] = u.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w .@-]/g, '')
  if (conCuerpo) headers['Content-Type'] = 'application/json'
  return headers
}

async function fallo(r: Response): Promise<never> {
  let data: unknown = null
  try { data = await r.json() } catch { /* cuerpo vacío */ }
  const d = data as { detail?: unknown; codigo?: string } | null
  let msg = typeof d?.detail === 'string' ? d.detail : ''
  let codigo = d?.codigo
  if (!msg && d?.detail && typeof d.detail === 'object' && !Array.isArray(d.detail)) {
    const o = d.detail as { mensaje?: string; campo?: string }
    msg = o.mensaje ?? ''
    codigo = o.campo
  }
  if (!msg && Array.isArray(d?.detail)) msg = 'Hay datos inválidos en el formulario.'
  throw new ApiError(msg || `Error ${r.status}`, r.status, codigo)
}

export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  let r: Response
  try {
    r = await fetch(`/api${path}`, { method: init.method ?? 'GET', headers: cabeceras(init.body !== undefined), body: init.body !== undefined ? JSON.stringify(init.body) : undefined })
  } catch {
    throw new ApiError('No hay conexión con el servidor del CRM.', 0)
  }
  if (r.status === 204) return undefined as T
  if (!r.ok) return fallo(r)
  try { return (await r.json()) as T } catch { return undefined as T }
}

/** Sube la imagen (banner) tal cual; el servidor la valida, la reescribe como WebP y devuelve su id. */
export async function subirBanner(archivo: File): Promise<Banner> {
  let r: Response
  try {
    r = await fetch('/api/campanas/banners', { method: 'POST', headers: { ...cabeceras(false), 'Content-Type': archivo.type || 'application/octet-stream' }, body: archivo })
  } catch { throw new ApiError('No hay conexión con el servidor del CRM.', 0) }
  if (!r.ok) return fallo(r)
  const b = (await r.json()) as Banner
  return { id: b.id, ancho: b.ancho, alto: b.alto, nombre: archivo.name.slice(0, 120) }
}
export const urlBanner = (id: string) => `/media/banners/${encodeURIComponent(id)}.webp`

/** Descarga un archivo de la API (respeta la clave y el usuario). */
export async function descargar(path: string, nombre: string): Promise<void> {
  let r: Response
  try { r = await fetch(`/api${path}`, { headers: cabeceras(false) }) } catch { throw new ApiError('No hay conexión con el servidor del CRM.', 0) }
  if (!r.ok) return fallo(r)
  const a = document.createElement('a'); a.href = URL.createObjectURL(await r.blob()); a.download = nombre; a.click(); URL.revokeObjectURL(a.href)
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
  activo?: boolean; descuento_calculo?: CalculoDescuento
}
/** Cómo se llegó al descuento sugerido (lo arma el servidor con el precio y el último costo del ERP). */
export interface CalculoDescuento {
  precio: number; costo: number; margen_pct: number; factor_pct: number; tope_pct: number; posible_pct: number; descuento_pct: number
  limitado_por_tope: boolean; precio_con_descuento: number; ganancia_antes: number; ganancia_despues: number; margen_despues_pct: number
}
export interface Opcion { codigo: string; nombre: string; productos: number }
export interface Filtros { familias: Opcion[]; departamentos: Opcion[]; grupos: Opcion[]; secciones: Opcion[]; tipos: Opcion[]; marcas: Opcion[] }
export interface Temporada { id: string; nombre: string; inicio: string; fin: string; estado: string; dias_para_inicio: number; contexto: string; anticipacion: number }
export interface Textos {
  whatsapp?: { texto: string }; sms?: { texto: string }
  email?: { asunto: string; preheader?: string; cuerpo: string }
}
/** Imagen del publicista que va arriba en WhatsApp y en el correo. */
export interface Banner { id: string; ancho?: number; alto?: number; nombre?: string }
export interface Mensaje {
  modo: 'ia' | 'manual'; prompt: string; tono: string; canales: string[]; textos: Textos; tokens: number; temporada_id?: string | null
  banner?: Banner | null
  /** Productos cuya foto (y tarjeta) no se muestran en el mensaje: se quitan con la (x) de la vista previa. */
  fotos_ocultas?: string[]
}
export interface Campana {
  id: string; nombre: string; objetivo: string; estado: 'borrador' | 'programada' | 'publicada'; paso: number
  productos: Producto[]; mensaje: Partial<Mensaje>; segmentacion: { filtros?: Record<string, unknown> }
  audiencia: number; costo_estimado: number; creada: string; actualizada: string; publicada_en: string | null
  programada_para?: string | null; control_pct?: number; grupos?: { envio: number; control: number }
  vigencia_desde?: string | null; vigencia_hasta?: string | null
  n_productos?: number
}
export interface Momento {
  dias: { id: number; n: number }[]; franjas: { id: string; n: number }[]
  mejor_dia: number | null; mejor_franja: string | null
}
export interface Resumen {
  base_clientes: number; audiencia_candidata: number; audiencia: number; por_canal: Record<string, number>
  costo_estimado: number; costo_por_contacto: number; puntaje_promedio: number
  segmentos_rfm: { id: string; nombre: string; n: number }[]; sexo: { id: string; n: number }[]
  edades: { id: string; n: number }[]; ciclo: { id: string; nombre: string; n: number }[]; ciudades: { id: string; n: number }[]
  momento?: Momento
  curva: { pct_audiencia: number; pct_potencial: number; contactos: number; puntaje_corte: number }[]
  relacion_productos?: { id: string; n: number }[]
  corte_recomendado: { contactos: number; pct_audiencia: number; pct_potencial: number; puntaje_minimo: number } | null
}
export interface Preview {
  resumen: Resumen
  muestra: { cliente: string; celular: string; correo: string; puntaje: number; afinidad: number; segmento: string; canales: string[]; motivos: string[] }[]
  restricciones: { alcohol_o_tabaco: string[]; excluye_menores: boolean; excluidos_por_campana_reciente: number; excluidos_por_erp?: number; excluidos_por_canal?: number; excluidos_compradores?: number }
}
export interface OpcionesSeg {
  segmentos_rfm: Record<string, string>; ciclo: Record<string, string>; edades: string[]; clubs: string[]
  objetivos: Record<string, string>; costos: Record<string, number>; canales: string[]
  excluir_compradores?: Record<string, string>; habitual_compras?: number[]; habitual_dias?: number[]
}
export interface Estado {
  datos: boolean; ia: boolean; zona: string; modo: string
  etl: { corriendo: boolean; mensaje: string; error: string | null }
  warehouse?: { fecha_min: string; fecha_max: string; construido: string; clientes: number; clientes_con_compras: number; productos: number; lineas_venta: number }
}

// ------------------------------------------------------------------------------------ configuración de canales
export type CanalId = 'whatsapp' | 'email' | 'sms'
export interface CampoConfig {
  clave: string; etiqueta: string; tipo: 'texto' | 'secreto' | 'numero' | 'email' | 'url' | 'opcion' | 'variables'
  requerido: boolean; ayuda: string; defecto: unknown; opciones: Record<string, string> | null; patron: string | null
  minimo: number | null; maximo: number | null; fijo: boolean
}
export interface PlantillaMeta { nombre: string; idioma: string; estado: string; categoria: string; encabezado: string; variables: number; cuerpo: string }
export interface EstadoCanal {
  canal: CanalId; nombre: string; proveedor: string | null; activo: boolean; datos: Record<string, unknown>
  secretos: Record<string, { guardado: boolean; final: string | null }>; faltantes: string[]; configurado: boolean; disponible: boolean
  error_secretos: string | null; plantillas: PlantillaMeta[]; actualizado: string | null; actualizado_por: string | null
  prueba: { fecha: string; ok: boolean; detalle: string } | null
}
export interface ConfigCanales {
  canales: EstadoCanal[]; puede_editar: boolean; fuentes_variable: Record<string, string>
  catalogo: Record<CanalId, Record<string, { nombre: string; ayuda: string; campos: CampoConfig[] }>>
}
/** Qué canales se pueden usar (configurados y activos) y su costo por mensaje. */
export const useCanalesDisponibles = () =>
  useGet<{ canales: Record<CanalId, boolean>; motivos: Record<CanalId, string | null>; costos: Record<CanalId, number>; desarrollo?: boolean }>('/configuracion/disponibles', { stale: 30_000 })

// ------------------------------------------------------------------------------------ configuración general
export interface CampoGeneral {
  clave: string; etiqueta: string; tipo: 'texto' | 'texto_largo' | 'numero' | 'email' | 'url' | 'color' | 'hora' | 'booleano' | 'canales'
  defecto: unknown; ayuda: string; minimo: number | null; maximo: number | null; opciones: Record<string, string> | null; requerido: boolean
}
export interface Empresa {
  nombre: string; razon_social: string | null; nit: string | null; direccion: string | null; ciudad: string | null; telefono: string | null
  correo_contacto: string | null; tienda_url: string | null; tienda_texto: string; instagram: string | null; facebook: string | null
  tiktok: string | null; whatsapp_contacto: string | null; color: string
}
export interface Legal { politica_url: string | null; pie_correo: string; url_publica: string | null; rne_activo: boolean; rne_canales: string[]; rne_max_dias: number; rne_exentos_autorizados: boolean }
export interface Reglas { excluir_contactados_dias: number; control_pct: number; vigencia_max_dias: number; habitual_compras: number; habitual_dias: number; descuento_factor_pct: number; descuento_tope_pct: number }
export interface ConfigGeneral {
  valores: { empresa: Empresa; legal: Legal; reglas: Reglas; presupuesto: Record<string, number>; etl: { automatica: boolean; hora: string } }
  meta: Record<string, { actualizado: string | null; actualizado_por: string | null }>
  esquema: Record<string, { titulo: string; campos: CampoGeneral[] }>
  logo: boolean; politica_pdf: boolean; puede_editar: boolean
  etl: { ultima_automatica: string | null; resultado: { fecha: string; ok: boolean; error?: string } | null; ads_configurado: boolean
    estado: { corriendo: boolean; mensaje: string; inicio: string | null; fin: string | null; error: string | null } }
}
export const useConfigGeneral = () => useGet<ConfigGeneral>('/configuracion/general', { stale: 60_000 })
export interface ConsumoCanal { gastado: number; tope: number | null; pct: number | null; disponible: number | null; alerta: boolean; agotado: boolean }
export interface Consumo { mes: string; alerta_pct: number; canales: Record<CanalId, ConsumoCanal> }
export const useConsumo = () => useGet<Consumo>('/configuracion/presupuesto/consumo', { stale: 60_000 })

/** Sube un archivo tal cual (logo, PDF, lista del RNE, foto) a una ruta de la API que lo recibe como cuerpo. */
export async function subirArchivo<T>(path: string, archivo: File | Blob, tipo?: string): Promise<T> {
  let r: Response
  try {
    r = await fetch(`/api${path}`, { method: 'POST', headers: { ...cabeceras(false), 'Content-Type': tipo || archivo.type || 'application/octet-stream' }, body: archivo })
  } catch { throw new ApiError('No hay conexión con el servidor del CRM.', 0) }
  if (!r.ok) return fallo(r)
  return (await r.json()) as T
}
