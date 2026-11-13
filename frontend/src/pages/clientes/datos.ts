/**
 * Capa de datos de Clientes 360°: TODO viene de la API (/api/clientes), que lee y escribe en ADVANTAGE.
 * Las pantallas solo hablan con estas funciones.
 */
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ApiError } from '@/lib/api'
import type { Afiliacion, Cambio, Catalogos, Cliente, Compra, DatosCliente, FilaCliente, Sesion } from './modelo'

const B = '/clientes'
const qs = (p: Record<string, unknown>) => {
  const u = new URLSearchParams()
  for (const [k, v] of Object.entries(p)) {
    if (v == null || v === '' || (Array.isArray(v) && !v.length)) continue
    u.set(k, Array.isArray(v) ? v.join(',') : String(v))
  }
  const s = u.toString()
  return s ? `?${s}` : ''
}
/** El índice tarda ~15 s en cargar la primera vez: mientras tanto la API responde 503 y se reintenta solo. */
const reintentar = (n: number, e: unknown) => e instanceof ApiError && e.status === 503 && n < 20
const espera = () => 3000

export const useSesion = () => useQuery<Sesion>({ queryKey: ['cli-sesion'], queryFn: () => api(`${B}/sesion`), staleTime: 15_000, refetchInterval: (q) => (q.state.data?.indice.listo && !q.state.data.indice.cargando ? 60_000 : 2500) })
export const useCatalogos = () => useQuery<Catalogos>({ queryKey: ['cli-catalogos'], queryFn: () => api(`${B}/catalogos`), staleTime: 5 * 60_000, retry: reintentar, retryDelay: espera })

export interface FiltrosLista {
  q?: string; estado?: string[]; segmentos?: string[]; consentimiento?: string[]; club?: string; mascota?: string; ciudad?: string
  completitudMax?: number; problema?: string; etiqueta?: string; vista?: string; orden?: string; dir?: 'asc' | 'desc'; pagina?: number; porPagina?: number
}
export const parametros = (f: FiltrosLista) => qs({ ...f, completitudMax: f.completitudMax === 100 ? undefined : f.completitudMax })

export const useLista = (f: FiltrosLista) => useQuery<{ total: number; pagina: number; porPagina: number; filas: FilaCliente[] }>({
  queryKey: ['cli-lista', f], queryFn: () => api(`${B}${parametros(f)}`), placeholderData: keepPreviousData, retry: reintentar, retryDelay: espera, staleTime: 30_000,
})
export interface Kpis { total: number; consent: number; cel: number; mail: number; comp: number; compradores: number; otros: Record<string, number> }
export const useKpis = () => useQuery<Kpis>({ queryKey: ['cli-kpis'], queryFn: () => api(`${B}/kpis`), retry: reintentar, retryDelay: espera, staleTime: 30_000 })

export const useFicha = (id: string | undefined) => useQuery<Cliente>({
  queryKey: ['cli-ficha', id], queryFn: () => api(`${B}/${encodeURIComponent(id!)}`), enabled: !!id, retry: reintentar, retryDelay: espera, staleTime: 10_000,
})
export const useCompras = (id: string, n = 20) => useQuery<{ compras: Compra[]; top: { nombre: string; n: number }[]; metricasHasta: string | null }>({
  queryKey: ['cli-compras', id, n], queryFn: () => api(`${B}/${encodeURIComponent(id)}/compras?n=${n}`), staleTime: 5 * 60_000,
})
export const useCambios = (id: string) => useQuery<Cambio[]>({ queryKey: ['cli-cambios', id], queryFn: () => api(`${B}/${encodeURIComponent(id)}/cambios`) })
export interface ContactoCampana { id: string; nombre: string; estado: string; fecha: string; canales: string; grupo: string }
export const useCampanasCliente = (id: string) => useQuery<ContactoCampana[]>({ queryKey: ['cli-campanas', id], queryFn: () => api(`${B}/${encodeURIComponent(id)}/campanas`) })
export interface Referencias { compras: number; campanas: number; mascotas: number; afiliaciones: number; vehiculos: number; notas: number; puntos: number; puedeEliminar: boolean; motivoNoEliminar: string }
export const useReferencias = (id: string, enabled: boolean) => useQuery<Referencias>({ queryKey: ['cli-ref', id], queryFn: () => api(`${B}/${encodeURIComponent(id)}/referencias`), enabled })

export interface Calidad { activos: number; prom: number; problemas: Record<string, number>; cola: FilaCliente[] }
export const useCalidad = () => useQuery<Calidad>({ queryKey: ['cli-calidad'], queryFn: () => api(`${B}/calidad`), retry: reintentar, retryDelay: espera })
export interface GrupoDuplicado { clave: string; motivo: string; ids: string[]; venta: number }
export const useDuplicados = (enabled = true) => useQuery<{ total: number; grupos: GrupoDuplicado[]; clientes: Record<string, FilaCliente> }>({
  queryKey: ['cli-duplicados'], queryFn: () => api(`${B}/duplicados`), enabled, retry: reintentar, retryDelay: espera,
})
export const useAfiliaciones = () => useQuery<Afiliacion[]>({ queryKey: ['cli-afiliaciones'], queryFn: () => api(`${B}/afiliaciones`) })

// ------------------------------------------------------------------------------------------ escritura
/** Mutación que, al terminar, refresca todo lo de clientes (lista, KPI, ficha, calidad) para que nada quede viejo. */
export function useMutar<V, R = unknown>(fn: (v: V) => Promise<R>, opts: { ficha?: (r: R, v: V) => string | undefined } = {}) {
  const qc = useQueryClient()
  return useMutation<R, ApiError, V>({
    mutationFn: fn,
    onSuccess: (r, v) => {
      const id = opts.ficha?.(r, v)
      if (id && r && typeof r === 'object' && 'tarjeta' in (r as object)) qc.setQueryData(['cli-ficha', id], r)
      void qc.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith('cli-') && q.queryKey[0] !== 'cli-catalogos' && !(id && q.queryKey[0] === 'cli-ficha' && q.queryKey[1] === id) })
      void qc.invalidateQueries({ queryKey: ['cli-catalogos'] })
    },
  })
}

const e = encodeURIComponent
export const op = {
  crear: (d: Partial<DatosCliente>) => api<Cliente>(B, { method: 'POST', body: d }),
  actualizar: (v: { id: string; cambios: Partial<DatosCliente>; version: string }) => api<Cliente>(`${B}/${e(v.id)}`, { method: 'PATCH', body: { cambios: v.cambios, version: v.version } }),
  estado: (v: { id: string; estado: 'activo' | 'inactivo'; motivo?: string }) => api<Cliente>(`${B}/${e(v.id)}/estado`, { method: 'POST', body: { estado: v.estado, motivo: v.motivo ?? '' } }),
  anonimizar: (id: string) => api<Cliente>(`${B}/${e(id)}/anonimizar`, { method: 'POST' }),
  eliminar: (id: string) => api<void>(`${B}/${e(id)}`, { method: 'DELETE' }),
  mascota: (v: { id: string; m: Record<string, unknown> }) => api<Cliente>(`${B}/${e(v.id)}/mascotas`, { method: 'POST', body: v.m }),
  borrarMascota: (v: { id: string; mid: string }) => api<Cliente>(`${B}/${e(v.id)}/mascotas/${e(v.mid)}`, { method: 'DELETE' }),
  vehiculo: (v: { id: string; x: Record<string, unknown> }) => api<Cliente>(`${B}/${e(v.id)}/vehiculos`, { method: 'POST', body: v.x }),
  borrarVehiculo: (v: { id: string; vid: string }) => api<Cliente>(`${B}/${e(v.id)}/vehiculos/${e(v.vid)}`, { method: 'DELETE' }),
  socio: (v: { id: string; s: Record<string, unknown> }) => api<Cliente>(`${B}/${e(v.id)}/afiliaciones`, { method: 'POST', body: v.s }),
  borrarSocio: (v: { id: string; sid: string }) => api<Cliente>(`${B}/${e(v.id)}/afiliaciones/${e(v.sid)}`, { method: 'DELETE' }),
  nota: (v: { id: string; n: Record<string, unknown> }) => api<Cliente>(`${B}/${e(v.id)}/notas`, { method: 'POST', body: v.n }),
  alternarNota: (v: { id: string; nid: string }) => api<Cliente>(`${B}/${e(v.id)}/notas/${e(v.nid)}/alternar`, { method: 'POST' }),
  borrarNota: (v: { id: string; nid: string }) => api<Cliente>(`${B}/${e(v.id)}/notas/${e(v.nid)}`, { method: 'DELETE' }),
  afiliacion: (a: Partial<Afiliacion>) => api<Afiliacion[]>(`${B}/afiliaciones`, { method: 'POST', body: a }),
  borrarAfiliacion: (id: string) => api<Afiliacion[]>(`${B}/afiliaciones/${e(id)}`, { method: 'DELETE' }),
  masivo: (v: { ids: string[]; accion: 'club' | 'etiqueta' | 'desactivar'; valor?: string }) => api<{ afectados: number }>(`${B}/masivo`, { method: 'POST', body: { ...v, valor: v.valor ?? '' } }),
  fusionar: (v: { ganador: string; perdedor: string; tomar: string[] }) => api<Cliente>(`${B}/fusionar`, { method: 'POST', body: v }),
  descartarDuplicado: (ids: string[]) => api<void>(`${B}/duplicados/descartar`, { method: 'POST', body: { ids } }),
  validarImport: (filas: Record<string, string>[]) => api<FilaImport[]>(`${B}/importar/validar`, { method: 'POST', body: { filas } }),
  aplicarImport: (filas: Record<string, string>[]) => api<{ creados: number; actualizados: number; errores: string[] }>(`${B}/importar/aplicar`, { method: 'POST', body: { filas } }),
  recargarIndice: () => api<void>(`${B}/indice/recargar`, { method: 'POST' }),
}
export interface FilaImport { fila: number; id: string; existe: boolean; nombres: string; apellidos: string; celular: string; email: string; ciudad: string; errores: string[] }

export const HOY_ISO = new Date().toISOString().slice(0, 10)
export const proximaRecompra = (c: Pick<Cliente, 'ultimaCompra' | 'intervaloDias'>): string | null => {
  if (!c.ultimaCompra || !c.intervaloDias) return null
  return new Date(new Date(c.ultimaCompra).getTime() + c.intervaloDias * 864e5).toISOString().slice(0, 10)
}

/** Etiqueta legible de cada campo en la auditoría (columnas del ERP y del CRM). */
export const ETIQUETA_CAMPO: Record<string, string> = {
  NOMBRE: 'Primer nombre', NOMBRE2: 'Segundo nombre', APELLIDO: 'Primer apellido', APELLIDO2: 'Segundo apellido', NOMCLI: 'Nombre completo (ERP)',
  TIPODOC: 'Tipo de documento', TIPCLI: 'Tipo de cliente', SEXO: 'Género', FECHAN: 'Fecha de nacimiento', ANON: 'Año de nacimiento', CODPROFE: 'Profesión',
  PROFESION1: 'Profesión (texto)', EMPRESA: 'Empresa', ECIVIL: 'Estado civil', HIJOS: 'Hijos', TELCELU: 'Celular', TELCLI1: 'Teléfono', EMAIL: 'Correo',
  CIUDAD: 'Ciudad', CIUCLI: 'Ciudad (texto)', CODBARRIO: 'Barrio', BARRIO1: 'Barrio (texto)', DIRCLI1: 'Dirección', INFOLEY: 'Autoriza datos (Ley 1581)',
  INFOTEX: 'Autoriza SMS', INFOELEC: 'Autoriza correo', INFOWAS: 'Autoriza WhatsApp', MASCOTA: 'Tiene mascota (POS)', CODMASCO: 'Tipo de mascota (POS)',
  TMASCOTA: 'Mascota (POS)', NOMMASCO: 'Nombre de mascota (POS)', TCARRO: 'Tiene carro (POS)', CODVEHI: 'Vehículo (POS)', TVEHI: 'Vehículo (texto POS)',
  CLUBVINO: 'Club del Vino (POS)', CLUBAMAC: 'Club AMAC (POS)', CLUBPARRI: 'Club Parrilla (POS)', CLUBSALUD: 'Club Salud (POS)', CLUBMASCO: 'Club Mascotas (POS)',
  ESTADO: 'Estado en el CRM', MOTIVO_ESTADO: 'Motivo del estado', ETIQUETAS: 'Etiquetas', OBSERVACIONES: 'Observaciones', CONSENT_FECHA: 'Fecha del consentimiento',
  CONSENT_MEDIO: 'Medio del consentimiento', FUSIONADO_EN: 'Fusionado en',
}
