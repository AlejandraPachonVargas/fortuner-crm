import clsx from 'clsx'
import { ArrowLeft, Camera, ChevronLeft, Mail, MessageCircle, MessageSquareText, Mic, MoreVertical, Phone, Plus, Video, X } from 'lucide-react'
import { createContext, Fragment, useContext, useId, useMemo, useState, type ReactNode } from 'react'
import FotoProducto, { urlFoto, useFotos } from '@/components/FotoProducto'
import { urlBanner, useConfigGeneral, type Mensaje, type Producto } from '@/lib/api'
import { CANAL_LABEL, fmtCop } from '@/lib/format'

/**
 * Vista previa «tal como la vería el cliente»: un teléfono con WhatsApp, un teléfono con la app de mensajes (SMS) y un
 * cliente de correo (bandeja + mensaje abierto). Todo se dibuja con texto plano de React (nunca HTML inyectado), así
 * que un texto con etiquetas se ve literal y no puede ejecutar nada.
 */
/** La marca de la empresa (Configuración › Empresa y Legal). Mientras carga, valores neutros. */
interface Marca {
  nombre: string; color: string; logo: boolean; tiendaTexto: string; tiendaUrl: string | null; pie: string; politica: string | null
  datos: string; redes: string[]
}
const MARCA_DEFECTO: Marca = { nombre: 'Mi empresa', color: '#003760', logo: false, tiendaTexto: 'Visítanos en la tienda', tiendaUrl: null, pie: '', politica: null, datos: '', redes: [] }
const MarcaCtx = createContext<Marca>(MARCA_DEFECTO)
const inicial = (n: string) => (n.trim()[0] ?? 'E').toUpperCase()

function Avatar({ tam, fondo, texto }: { tam: number; fondo: string; texto: string }) {
  const m = useContext(MarcaCtx)
  if (m.logo) return <span className="grid shrink-0 place-items-center overflow-hidden rounded-full bg-white" style={{ width: tam, height: tam }}><img src="/media/empresa/logo.webp" alt="" className="max-h-full max-w-full object-contain p-0.5" /></span>
  return <span className="grid shrink-0 place-items-center rounded-full font-extrabold" style={{ width: tam, height: tam, background: fondo, color: texto, fontSize: tam * 0.42 }}>{inicial(m.nombre)}</span>
}

const hora = () => new Date().toLocaleTimeString('es-CO', { hour: 'numeric', minute: '2-digit', hour12: false })
const personalizar = (t: string, nombre: string, vigencia: string) => t.replace(/\{nombre\}/gi, nombre).replace(/\{vigencia\}/gi, vigencia)
// Texto de la vigencia en la vista previa: las fechas reales si ya se eligieron; si no, un ejemplo.
const VigenciaCtx = createContext('del 22 al 24 de noviembre')

/** WhatsApp: *negrita*, _cursiva_ y ~tachado~ (se convierten a elementos, no a HTML). */
function formatoWA(texto: string): ReactNode[] {
  return texto.split(/(\*[^*\n]+\*|_[^_\n]+_|~[^~\n]+~)/g).map((p, i) => {
    if (p.length > 2 && p.startsWith('*') && p.endsWith('*')) return <b key={i}>{p.slice(1, -1)}</b>
    if (p.length > 2 && p.startsWith('_') && p.endsWith('_')) return <i key={i}>{p.slice(1, -1)}</i>
    if (p.length > 2 && p.startsWith('~') && p.endsWith('~')) return <s key={i}>{p.slice(1, -1)}</s>
    return <Fragment key={i}>{p}</Fragment>
  })
}

/** (x) en la esquina de una imagen de la vista previa: la quita del mensaje (solo mientras se edita). */
function Quitar({ onClick, que }: { onClick?: () => void; que: string }) {
  if (!onClick) return null
  return (
    <button type="button" onClick={onClick} aria-label={`Quitar ${que}`} title={`Quitar ${que}`}
      className="absolute top-1.5 right-1.5 z-10 grid h-7 w-7 place-items-center rounded-full bg-black/60 text-white shadow-md ring-2 ring-white/80 transition hover:bg-[#d93025]">
      <X size={15} strokeWidth={2.75} />
    </button>
  )
}

interface Imagen { src: string; alt: string; que: string; quitar?: () => void }

function Telefono({ children, etiqueta }: { children: ReactNode; etiqueta: string }) {
  // Tarjeta limpia, sin marco de celular: sombra suave y bordes redondeados.
  return (
    <div role="group" aria-label={etiqueta} className="mx-auto w-full max-w-[340px] overflow-hidden rounded-3xl bg-white shadow-[0_20px_50px_-14px_rgba(11,29,54,0.30)] ring-1 ring-black/5">
      {children}
    </div>
  )
}

// ----------------------------------------------------------------------------------------------- WhatsApp
function WhatsAppVista({ texto, nombre, imagen }: { texto: string; nombre: string; imagen?: Imagen | null }) {
  const vig = useContext(VigenciaCtx)
  const m = useContext(MarcaCtx)
  return (
    <Telefono etiqueta="Así se vería el mensaje en WhatsApp">
      <div className="bg-[#075e54] pt-2">
        <div className="flex items-center gap-2 px-2 pt-1 pb-2 text-white">
          <ArrowLeft size={18} />
          <Avatar tam={32} fondo="#ffffff" texto="#075e54" />
          <span className="min-w-0 flex-1 leading-tight"><span className="block truncate text-[13.5px] font-semibold">{m.nombre}</span><span className="block text-[10.5px] opacity-80">Cuenta de empresa</span></span>
          <Video size={17} /><Phone size={16} /><MoreVertical size={17} />
        </div>
      </div>
      <div className="min-h-[300px] bg-[#efeae2] px-2.5 py-3" style={{ backgroundImage: 'radial-gradient(rgba(0,0,0,.045) 1px, transparent 1px)', backgroundSize: '14px 14px' }}>
        <div className="mx-auto mb-2.5 w-fit rounded-md bg-[#fff5c4] px-2 py-0.5 text-[10px] text-[#54656f] shadow-sm">HOY</div>
        {texto ? (
          <div className="relative max-w-[88%] rounded-lg rounded-tl-none bg-white px-2.5 pt-1.5 pb-4 text-[12.5px] leading-[1.35] whitespace-pre-wrap text-[#111b21] shadow-sm">
            {/* WhatsApp admite UNA imagen arriba del texto: el banner, o si no hay, la foto del primer producto. */}
            {imagen && (
              <div className="relative -mx-1.5 mb-1.5 overflow-hidden rounded-md bg-[#f0f2f5]">
                <img src={imagen.src} alt={imagen.alt} className="max-h-64 w-full object-contain" />
                <Quitar onClick={imagen.quitar} que={imagen.que} />
              </div>
            )}
            {formatoWA(personalizar(texto, nombre, vig))}
            <span className="absolute right-2 bottom-1 text-[9.5px] text-[#667781]">{hora()}</span>
          </div>
        ) : <p className="rounded-lg bg-white/70 px-3 py-2 text-center text-[12px] text-[#667781]">Aquí aparecerá el mensaje.</p>}
      </div>
      <div className="flex items-center gap-2 bg-[#f0f2f5] px-2 py-2 text-[#54656f]" aria-hidden>
        <Plus size={18} /><span className="flex-1 rounded-full bg-white px-3 py-1.5 text-[12px] text-[#8696a0]">Mensaje</span><Camera size={17} /><Mic size={18} />
      </div>
    </Telefono>
  )
}

// ----------------------------------------------------------------------------------------------- SMS
function SmsVista({ texto, nombre }: { texto: string; nombre: string }) {
  const vig = useContext(VigenciaCtx)
  const m = useContext(MarcaCtx)
  return (
    <Telefono etiqueta="Así se vería el SMS en el celular">
      <div className="bg-[#f6f6f8] pt-2 pb-1.5">
        <div className="flex items-center px-2 text-[#007aff]"><ChevronLeft size={22} /><span className="flex-1" /></div>
        <div className="-mt-4 flex flex-col items-center pb-1">
          <span className="grid h-9 w-9 place-items-center rounded-full bg-[#a5aab3] text-[14px] font-bold text-white">{inicial(m.nombre)}</span>
          <span className="mt-0.5 text-[10.5px] font-medium text-black">{m.nombre.toUpperCase()}</span>
        </div>
      </div>
      <div className="min-h-[300px] border-t border-[#d1d1d6] bg-white px-3 py-3">
        <div className="mb-2.5 text-center text-[10px] text-[#8e8e93]"><b>Mensaje de texto</b> · Hoy {hora()}</div>
        {texto ? (
          <div className="max-w-[80%] rounded-[1.15rem] rounded-bl-md bg-[#e9e9eb] px-3 py-2 text-[13px] leading-[1.3] whitespace-pre-wrap text-black">{personalizar(texto, nombre, vig)}</div>
        ) : <p className="text-center text-[12px] text-[#8e8e93]">Aquí aparecerá el SMS.</p>}
      </div>
      <div className="flex items-center gap-2 border-t border-[#d1d1d6] bg-white px-2.5 py-2" aria-hidden>
        <Camera size={19} className="text-[#8e8e93]" /><span className="flex-1 rounded-full border border-[#d1d1d6] px-3 py-1 text-[12px] text-[#8e8e93]">Mensaje de texto</span><Mic size={18} className="text-[#8e8e93]" />
      </div>
    </Telefono>
  )
}

// ----------------------------------------------------------------------------------------------- correo
interface CorreoProps { asunto: string; preheader: string; cuerpo: string; nombre: string; productos: Producto[]; banner?: Imagen | null; onOcultar?: (id: string) => void }

function CorreoVista({ asunto, preheader, cuerpo, nombre, productos, banner, onOcultar }: CorreoProps) {
  const vig = useContext(VigenciaCtx)
  const m = useContext(MarcaCtx)
  const parrafos = personalizar(cuerpo, nombre, vig).split(/\n{2,}/).map((p) => p.trim()).filter(Boolean)
  const vista = personalizar(preheader, nombre, vig) || (parrafos[0] ?? '').slice(0, 90)
  const dest = productos.slice(0, 4)
  return (
    <div role="group" aria-label="Así se vería el correo" className="mx-auto w-full max-w-[520px] overflow-hidden rounded-xl border border-[#dadce0] bg-[#f6f8fc] text-[#202124] shadow-lg">
      <div className="flex items-center gap-2 border-b border-[#dadce0] bg-white px-3 py-1.5 text-[11px] text-[#5f6368]" aria-hidden>
        <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]" /><span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]" /><span className="h-2.5 w-2.5 rounded-full bg-[#28c840]" />
        <span className="ml-2">Bandeja de entrada</span>
      </div>
      {/* fila de la bandeja: lo primero que ve el cliente */}
      <div className="flex items-start gap-2.5 border-b border-[#dadce0] bg-white px-3 py-2.5">
        <Avatar tam={32} fondo={m.color} texto="#ffffff" />
        <div className="min-w-0 flex-1 leading-tight">
          <div className="flex items-baseline gap-2"><span className="flex-1 truncate text-[12.5px] font-bold">{m.nombre}</span><span className="text-[10.5px] font-semibold text-[#202124]">{hora()}</span></div>
          <div className="truncate text-[12.5px] font-bold">{personalizar(asunto, nombre, vig) || <i className="font-normal text-[#5f6368]">(sin asunto)</i>}</div>
          <div className="truncate text-[11.5px] text-[#5f6368]">{vista || '…'}</div>
        </div>
      </div>
      {/* mensaje abierto */}
      <div className="bg-white p-3.5">
        <h3 className="text-[15px] leading-tight font-semibold">{personalizar(asunto, nombre, vig) || '(sin asunto)'}</h3>
        <div className="mt-2 flex items-center gap-2 text-[11px] text-[#5f6368]">
          <Avatar tam={28} fondo={m.color} texto="#ffffff" />
          <span className="leading-tight"><b className="text-[#202124]">{m.nombre}</b><br />para {nombre}</span>
        </div>
        <div className="mt-3 overflow-hidden rounded-lg border border-[#e8eaed]">
          <div className="flex items-center justify-center px-4 py-3.5" style={{ background: m.color }}>
            {m.logo ? <img src="/media/empresa/logo.webp" alt={m.nombre} className="max-h-10" /> : <span className="text-[17px] font-extrabold tracking-[0.25em] text-white">{m.nombre.toUpperCase()}</span>}
          </div>
          {banner && (
            <div className="relative bg-[#f8f9fa]">
              <img src={banner.src} alt={banner.alt} className="block w-full" />
              <Quitar onClick={banner.quitar} que={banner.que} />
            </div>
          )}
          <div className="space-y-2.5 px-4 py-4 text-[12.5px] leading-relaxed text-[#3c4043]">
            {parrafos.length ? parrafos.map((p, i) => <p key={i} className="whitespace-pre-line">{p}</p>) : <p className="text-[#80868b]">Aquí aparecerá el cuerpo del correo.</p>}
          </div>
          {dest.length > 0 && parrafos.length > 0 && (
            <div className="grid grid-cols-2 gap-2 px-4 pb-4">
              {dest.map((p) => (
                <div key={p.producto_id} className="relative rounded-lg border border-[#e8eaed] bg-[#f8f9fa] p-2.5">
                  <Quitar onClick={onOcultar && (() => onOcultar(p.producto_id))} que={`la foto de ${p.producto}`} />
                  <FotoProducto id={p.producto_id} nombre={p.producto} size={120} grande className="mx-auto mb-2 border-0" />
                  <div className="line-clamp-2 min-h-[2.1em] text-[11.5px] leading-snug font-semibold text-[#202124]">{p.producto}</div>
                  <div className="mt-1 text-[10.5px] text-[#5f6368]">{p.marca}</div>
                  {p.precio_venta > 0 && <div className="mt-1 text-[13px] font-extrabold text-[#0F70FC]">{fmtCop(p.precio_venta)}</div>}
                </div>
              ))}
            </div>
          )}
          {parrafos.length > 0 && <div className="px-4 pb-4 text-center">
            <span title={m.tiendaUrl ?? 'Falta el enlace de la tienda en Configuración › Empresa'} className="inline-block rounded-full px-5 py-2 text-[12.5px] font-bold text-white" style={{ background: m.color }}>{m.tiendaTexto}</span>
          </div>}
          <div className="space-y-1 border-t border-[#e8eaed] bg-[#f8f9fa] px-4 py-2.5 text-center text-[10px] leading-snug text-[#80868b]">
            {m.redes.length > 0 && <p className="font-semibold text-[#5f6368]">{m.redes.join(' · ')}</p>}
            <p>{m.pie}</p>
            <p><u title={m.politica ?? 'Falta la política en Configuración › Legal'}>Política de Tratamiento de Datos</u> · <u title="Enlace personal de baja de cada cliente">Cancelar suscripción</u></p>
            {m.datos && <p>{m.datos}</p>}
          </div>
        </div>
      </div>
    </div>
  )
}

// ----------------------------------------------------------------------------------------------- contenedor con pestañas
const ICONO = { whatsapp: MessageCircle, sms: MessageSquareText, email: Mail } as const

export default function VistaCanales({ vigencia, ...props }: Props & { vigencia?: string | null }) {
  const base = useContext(VigenciaCtx)
  const g = useConfigGeneral()
  const marca = useMemo<Marca>(() => {
    if (!g.data) return MARCA_DEFECTO
    const e = g.data.valores.empresa
    const l = g.data.valores.legal
    return {
      nombre: e.nombre || 'Mi empresa', color: e.color || '#003760', logo: g.data.logo, tiendaTexto: e.tienda_texto || 'Visítanos en la tienda',
      tiendaUrl: e.tienda_url, pie: (l.pie_correo || '').replace(/\{empresa\}/gi, e.nombre || ''),
      politica: l.politica_url || (g.data.politica_pdf ? '/media/legal/politica.pdf' : null),
      datos: [e.razon_social || e.nombre, e.nit && `NIT ${e.nit}`, e.direccion, e.ciudad, e.telefono].filter(Boolean).join(' · '),
      redes: [e.instagram && 'Instagram', e.facebook && 'Facebook', e.tiktok && 'TikTok', e.whatsapp_contacto && `WhatsApp ${e.whatsapp_contacto}`].filter(Boolean) as string[],
    }
  }, [g.data])
  return <MarcaCtx.Provider value={marca}><VigenciaCtx.Provider value={vigencia || base}><Vista {...props} /></VigenciaCtx.Provider></MarcaCtx.Provider>
}

type Props = {
  mensaje: Partial<Mensaje>; productos: Producto[]; className?: string; canal?: string; onCanal?: (c: string) => void; sinPestanas?: boolean; todos?: boolean
  /** Solo al editar: la (x) de las imágenes quita el banner u oculta la foto de un producto. */
  onQuitarBanner?: () => void; onOcultarFoto?: (id: string) => void
}

function Vista({ mensaje, productos, className, canal, onCanal, sinPestanas, todos, onQuitarBanner, onOcultarFoto }: Props) {
  const canales = (mensaje.canales ?? []).filter((c): c is 'whatsapp' | 'sms' | 'email' => c in ICONO)
  const [sel, setSel] = useState<string>('')
  const [nombre, setNombre] = useState('María')
  const idNombre = useId()
  const elegido = canal ?? sel
  const activo = canales.includes(elegido as never) ? elegido : canales[0]
  const t = mensaje.textos ?? {}
  const nombreOk = useMemo(() => nombre.trim().slice(0, 30) || 'María', [nombre])
  const fotos = useFotos()
  const ocultas = useMemo(() => new Set(mensaje.fotos_ocultas ?? []), [mensaje.fotos_ocultas])
  const visibles = useMemo(() => productos.filter((p) => !ocultas.has(p.producto_id)), [productos, ocultas])
  const banner: Imagen | null = mensaje.banner?.id
    ? { src: urlBanner(mensaje.banner.id), alt: 'Banner de la campaña', que: 'el banner', quitar: onQuitarBanner } : null
  const primera = visibles.find((p) => fotos.ids.has(p.producto_id))
  const imagenWA: Imagen | null = banner ?? (primera
    ? { src: urlFoto(primera.producto_id, fotos.versiones[primera.producto_id] ?? fotos.version), alt: primera.producto, que: `la foto de ${primera.producto}`, quitar: onOcultarFoto && (() => onOcultarFoto(primera.producto_id)) }
    : null)

  if (!canales.length) return <p className="text-[13px] text-ink-3">Elija al menos un canal para ver la vista previa.</p>
  return (
    <div className={className}>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div role="tablist" aria-label="Canal de la vista previa" className={clsx("flex rounded-xl bg-surface-2 p-1", (sinPestanas || todos) && "hidden")}>
          {canales.map((c) => {
            const I = ICONO[c]
            return (
              <button key={c} type="button" role="tab" aria-selected={activo === c} onClick={() => { setSel(c); onCanal?.(c) }}
                className={clsx('flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[12.5px] font-semibold', activo === c ? 'bg-surface text-brand shadow-sm' : 'text-ink-2 hover:text-ink')}><I size={14} />{CANAL_LABEL[c]}</button>
            )
          })}
        </div>
        <label htmlFor={idNombre} className="ml-auto flex items-center gap-1.5 text-[11.5px] text-ink-3">Vista con el nombre
          <input id={idNombre} value={nombre} maxLength={30} onChange={(e) => setNombre(e.target.value)} className="h-7 w-24 rounded-md border border-line-strong bg-surface px-2 text-[12px] text-ink" /></label>
      </div>
      <div className="rounded-2xl bg-gradient-to-br from-brand-soft/70 via-surface-2 to-surface-2 px-3 py-7">
        {todos ? (
          <div className={clsx('grid items-start gap-x-6 gap-y-8', canales.length > 1 && 'md:grid-cols-2', canales.length > 2 && 'xl:grid-cols-3')}>
            {canales.map((c) => (
              <div key={c} className="min-w-0">
                <div className="mb-3 flex items-center justify-center gap-1.5 text-[12px] font-bold tracking-wide text-ink-2 uppercase">{(() => { const I = ICONO[c]; return <I size={14} /> })()}{CANAL_LABEL[c]}</div>
                {c === 'whatsapp' && <WhatsAppVista texto={t.whatsapp?.texto ?? ''} nombre={nombreOk} imagen={imagenWA} />}
                {c === 'sms' && <SmsVista texto={t.sms?.texto ?? ''} nombre={nombreOk} />}
                {c === 'email' && <CorreoVista asunto={t.email?.asunto ?? ''} preheader={t.email?.preheader ?? ''} cuerpo={t.email?.cuerpo ?? ''} nombre={nombreOk} productos={visibles} banner={banner} onOcultar={onOcultarFoto} />}
              </div>
            ))}
          </div>
        ) : null}
        {!todos && activo === 'whatsapp' && <WhatsAppVista texto={t.whatsapp?.texto ?? ''} nombre={nombreOk} imagen={imagenWA} />}
        {!todos && activo === 'sms' && <SmsVista texto={t.sms?.texto ?? ''} nombre={nombreOk} />}
        {!todos && activo === 'email' && <CorreoVista asunto={t.email?.asunto ?? ''} preheader={t.email?.preheader ?? ''} cuerpo={t.email?.cuerpo ?? ''} nombre={nombreOk} productos={visibles} banner={banner} onOcultar={onOcultarFoto} />}
      </div>
      <p className="mt-2 text-[11px] text-ink-3">Aproximación de cómo lo verá el cliente: cada aplicación (y cada celular) puede variar un poco el diseño.</p>
    </div>
  )
}
