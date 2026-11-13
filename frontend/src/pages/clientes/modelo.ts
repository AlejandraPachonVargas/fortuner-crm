/**
 * Modelo de Clientes 360° (conectado a ADVANTAGE).
 *
 * Origen de cada dato:
 *  - POSCLI (ERP): identidad, nombres, contacto, ubicación, consentimiento, clubes históricos.
 *  - Tablas CRM_* (diccionario propio del CRM): estado, etiquetas, observaciones, mascotas, vehículos, afiliaciones, notas, auditoría.
 *  - Warehouse (ventas FADITE): visitas, venta, segmento, ciclo de compra (solo lectura).
 *  - GANAPTOS: catálogos de ciudades, departamentos, barrios, profesiones, tipos de mascota y vehículos.
 */

export type Sexo = 'F' | 'M' | 'N'
export type Consentimiento = 'si' | 'no' | 'sin_registro'
export type EstadoCliente = 'activo' | 'inactivo' | 'anonimizado'
export type Rol = 'admin' | 'mercadeo' | 'lectura'
export type TipoDoc = 'CC' | 'CE' | 'NIT' | 'TI' | 'PAS' | 'RC'

/** Datos personales editables (lo que viaja al formulario). */
export interface DatosCliente {
  documento: string
  tipoDoc: TipoDoc
  nombre1: string; nombre2: string; apellido1: string; apellido2: string
  sexo: Sexo
  nacimiento: string | null
  profesionId: string | null
  empresa: string; estadoCivil: string; hijos: number | null
  celular: string; telefono: string; email: string
  departamentoId: string; ciudadId: string; barrioId: string; direccion: string
  consentimiento: Consentimiento
  autorizaSms: boolean | null; autorizaEmail: boolean | null; autorizaWhatsapp: boolean | null
  consentFecha: string | null; consentMedio: string
  etiquetas: string[]; notas: string
}

export interface Mascota { id: string; tipoId: string; tipo: string; nombre: string; raza: string; nacimiento: string | null; sexo: 'H' | 'M' | 'N'; notas: string; activa: boolean; origen: string }
export interface Vehiculo { id: string; tipo: string; marca: string; linea: string; placa: string; anio: number | null; origen: string }
export interface ClienteAfiliacion { id: string; afiliacionId: string; ingreso: string | null; vence: string | null; carnet: string; estado: 'activa' | 'vencida' | 'suspendida'; origen: string }
export interface Nota { id: string; tipo: 'nota' | 'tarea'; texto: string; vence: string | null; hecha: boolean; autor: string; fecha: string | null }

/** Ficha completa de un cliente. */
export interface Cliente extends DatosCliente {
  id: string; tarjeta: string
  nombres: string; apellidos: string; nombreErp: string
  cumple: string | null
  profesionTexto: string; ciudadTexto: string; barrioTexto: string; telefono2: string
  clubesErp: Record<string, boolean>
  creado: string | null; modificadoErp: string | null; sucursal: string; origenWeb: boolean; origen: string
  puntos: number; ultimaAcumulacion: string | null; empleado: boolean; bloqueado: boolean; observacionErp: string
  estado: EstadoCliente; motivoEstado: string; fusionadoEn: string; fusionados: { tarjeta: string; documento: string }[]
  editable: boolean; avisos: string[]; version: string
  visitas: number; ventaTotal: number; ticketProm: number; ultimaCompra: string | null; primeraCompra: string | null
  intervaloDias: number | null; segmento: string; ciclo: string; diaPreferido: number | null; franjaPreferida: string | null
  metricasHasta: string | null
  mascotas: Mascota[]; vehiculos: Vehiculo[]; afiliaciones: ClienteAfiliacion[]; notasLista: Nota[]
}

/** Fila de la lista (liviana). */
export interface FilaCliente {
  id: string; tarjeta: string; documento: string; tipoDoc: TipoDoc; nombres: string; apellidos: string
  celular: string; email: string; celOk: boolean; emailOk: boolean; consentimiento: Consentimiento; estado: EstadoCliente
  segmento: string; ultimaCompra: string | null; ventaTotal: number; visitas: number; clubes: string[]; nMascotas: number
  completitud: number; ciudadId: string; editable: boolean; fusionadoEn: string; etiquetas: string[]
}

export interface Afiliacion {
  id: string; codigo: string; nombre: string; descripcion: string; beneficios: string; color: string; activa: boolean
  vigenciaMeses: number; campoPoscli: string; socios: number; sociosActivos: number
}

export interface Cambio { id: string; ts: string; autor: string; rol: string; accion: string; tabla: string; campo: string; antes: string; despues: string; estado: string; detalle: string }
export interface Compra { fecha: string; ticket: string; lineas: number; total: number; sede: string; productos: string[] }

export interface Opcion { id: string; nombre: string }
export interface Catalogos {
  departamentos: (Opcion & { origen: string })[]
  ciudades: (Opcion & { dpto: string })[]
  barrios: (Opcion & { ciudad: string; tipo: string; asignable: boolean })[]
  tiposMascota: Opcion[]
  profesiones: Opcion[]
  vehiculos: Opcion[]
  tiposVehiculo: string[]
  estadosCiviles: string[]
  tiposDoc: { id: TipoDoc; nombre: string }[]
  afiliaciones: Afiliacion[]
  sucursales: Record<string, string>
}

export interface Sesion {
  rol: 'admin' | 'mercadeo'; usuario: string; escritura: boolean
  permisos: Permisos
  origenes: { erp: boolean; crm: boolean; catalogos: boolean }
  indice: { listo: boolean; cargando: boolean; error: string | null; cargado_en: string | null; segundos: number | null; metricas_hasta: string | null }
}
export interface Permisos { editar: boolean; eliminar: boolean; importar: boolean; verContacto: boolean; fusionar: boolean }

// ------------------------------------------------------------------------------------------ listas fijas
export const RAZAS: Record<string, string[]> = {
  Perro: ['Criollo', 'Labrador', 'Golden Retriever', 'Pastor Alemán', 'French Poodle', 'Schnauzer', 'Bulldog', 'Chihuahua', 'Pitbull', 'Beagle', 'Yorkshire', 'Pinscher', 'Shih Tzu', 'Otra'],
  Gato: ['Criollo', 'Siamés', 'Persa', 'Angora', 'Bengalí', 'Otra'],
  Ave: ['Canario', 'Periquito', 'Loro', 'Cacatúa', 'Otra'], Reptil: ['Tortuga', 'Iguana', 'Otra'],
  Conejo: ['Mini lop', 'Cabeza de león', 'Otra'], Hamster: ['Sirio', 'Ruso', 'Otra'],
}
export const MARCAS_VEHICULO = ['Chevrolet', 'Renault', 'Mazda', 'Kia', 'Toyota', 'Nissan', 'Hyundai', 'Ford', 'Suzuki', 'Volkswagen', 'Yamaha', 'Honda', 'Bajaj', 'AKT', 'Auteco', 'Otra']
export const MEDIOS_CONSENTIMIENTO = ['Caja (formulario)', 'Correo de confirmación', 'WhatsApp', 'Web / App', 'Telefónico', 'Otro']

export const SEGMENTOS: Record<string, string> = {
  campeones: 'Campeones', leales: 'Leales', potenciales: 'Potenciales leales', nuevos: 'Nuevos', prometedores: 'Prometedores',
  atencion: 'Necesitan atención', no_perder: 'No se pueden perder', en_riesgo: 'En riesgo', hibernando: 'Hibernando', perdidos: 'Perdidos',
  sin_compras: 'Sin compras recientes',
}
export const CICLOS: Record<string, string> = {
  adelantado: 'Compró hace poco', en_ventana: 'En su ventana de recompra', atrasado: 'Atrasado en su ciclo', inactivo: 'Inactivo', sin_historial: 'Sin historial suficiente',
}
export const TONO_SEGMENTO: Record<string, 'good' | 'brand' | 'warn' | 'bad' | 'neutral'> = {
  campeones: 'good', leales: 'good', potenciales: 'brand', nuevos: 'brand', prometedores: 'brand', atencion: 'warn', no_perder: 'warn', en_riesgo: 'warn',
  hibernando: 'neutral', perdidos: 'bad', sin_compras: 'neutral',
}

export const ROLES: Record<Rol, { nombre: string; descripcion: string }> = {
  admin: { nombre: 'Administrador', descripcion: 'Ve y edita todo, fusiona, anonimiza, elimina e importa.' },
  mercadeo: { nombre: 'Mercadeo', descripcion: 'Ve y edita datos, mascotas, vehículos y clubes. No elimina, no fusiona ni importa.' },
  lectura: { nombre: 'Solo lectura', descripcion: 'Consulta con datos de contacto enmascarados (vista de prueba).' },
}

export const nombreCompleto = (c: { nombres: string; apellidos: string }) => `${c.nombres} ${c.apellidos}`.trim() || 'Sin nombre'
export const nombreOpcion = (lista: Opcion[] | undefined, id: string | null) => lista?.find((o) => o.id === id)?.nombre ?? ''
