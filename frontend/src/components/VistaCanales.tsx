import clsx from 'clsx'
import { ArrowLeft, Camera, ChevronLeft, Mail, MessageCircle, MessageSquareText, Mic, MoreVertical, Phone, Plus, Video } from 'lucide-react'
import { createContext, Fragment, useContext, useId, useMemo, useState, type ReactNode } from 'react'
import type { Mensaje, Producto } from '@/lib/api'
import { CANAL_LABEL, fmtCop } from '@/lib/format'

/**
 * Vista previa «tal como la vería el cliente»: un teléfono con WhatsApp, un teléfono con la app de mensajes (SMS) y un
 * cliente de correo (bandeja + mensaje abierto). Todo se dibuja con texto plano de React (nunca HTML inyectado), así
 * que un texto con etiquetas se ve literal y no puede ejecutar nada.
 */
const EMPRESA = 'Fortuner'

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

function Telefono({ children, etiqueta }: { children: ReactNode; etiqueta: string }) {
  // Tarjeta limpia, sin marco de celular: sombra suave y bordes redondeados.
  return (
    <div role="img" aria-label={etiqueta} className="mx-auto w-full max-w-[340px] overflow-hidden rounded-3xl bg-white shadow-[0_20px_50px_-14px_rgba(11,29,54,0.30)] ring-1 ring-black/5">
      {children}
    </div>
  )
}

// ----------------------------------------------------------------------------------------------- WhatsApp
function WhatsAppVista({ texto, nombre }: { texto: string; nombre: string }) {
  const vig = useContext(VigenciaCtx)
  return (
    <Telefono etiqueta="Así se vería el mensaje en WhatsApp">
      <div className="bg-[#075e54] pt-2">
        <div className="flex items-center gap-2 px-2 pt-1 pb-2 text-white">
          <ArrowLeft size={18} />
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-white text-[13px] font-extrabold text-[#075e54]">F</span>
          <span className="min-w-0 flex-1 leading-tight"><span className="block truncate text-[13.5px] font-semibold">{EMPRESA}</span><span className="block text-[10.5px] opacity-80">Cuenta de empresa</span></span>
          <Video size={17} /><Phone size={16} /><MoreVertical size={17} />
        </div>
      </div>
      <div className="min-h-[300px] bg-[#efeae2] px-2.5 py-3" style={{ backgroundImage: 'radial-gradient(rgba(0,0,0,.045) 1px, transparent 1px)', backgroundSize: '14px 14px' }}>
        <div className="mx-auto mb-2.5 w-fit rounded-md bg-[#fff5c4] px-2 py-0.5 text-[10px] text-[#54656f] shadow-sm">HOY</div>
        {texto ? (
          <div className="relative max-w-[88%] rounded-lg rounded-tl-none bg-white px-2.5 pt-1.5 pb-4 text-[12.5px] leading-[1.35] whitespace-pre-wrap text-[#111b21] shadow-sm">
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
  return (
    <Telefono etiqueta="Así se vería el SMS en el celular">
      <div className="bg-[#f6f6f8] pt-2 pb-1.5">
        <div className="flex items-center px-2 text-[#007aff]"><ChevronLeft size={22} /><span className="flex-1" /></div>
        <div className="-mt-4 flex flex-col items-center pb-1">
          <span className="grid h-9 w-9 place-items-center rounded-full bg-[#a5aab3] text-[14px] font-bold text-white">F</span>
          <span className="mt-0.5 text-[10.5px] font-medium text-black">{EMPRESA.toUpperCase()}</span>
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
function CorreoVista({ asunto, preheader, cuerpo, nombre, productos }: { asunto: string; preheader: string; cuerpo: string; nombre: string; productos: Producto[] }) {
  const vig = useContext(VigenciaCtx)
  const parrafos = personalizar(cuerpo, nombre, vig).split(/\n{2,}/).map((p) => p.trim()).filter(Boolean)
  const vista = personalizar(preheader, nombre, vig) || (parrafos[0] ?? '').slice(0, 90)
  const dest = productos.slice(0, 4)
  return (
    <div role="img" aria-label="Así se vería el correo" className="mx-auto w-full max-w-[520px] overflow-hidden rounded-xl border border-[#dadce0] bg-[#f6f8fc] text-[#202124] shadow-lg">
      <div className="flex items-center gap-2 border-b border-[#dadce0] bg-white px-3 py-1.5 text-[11px] text-[#5f6368]" aria-hidden>
        <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]" /><span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]" /><span className="h-2.5 w-2.5 rounded-full bg-[#28c840]" />
        <span className="ml-2">Bandeja de entrada</span>
      </div>
      {/* fila de la bandeja: lo primero que ve el cliente */}
      <div className="flex items-start gap-2.5 border-b border-[#dadce0] bg-white px-3 py-2.5">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[#003760] text-[13px] font-bold text-white">F</span>
        <div className="min-w-0 flex-1 leading-tight">
          <div className="flex items-baseline gap-2"><span className="flex-1 truncate text-[12.5px] font-bold">{EMPRESA}</span><span className="text-[10.5px] font-semibold text-[#202124]">{hora()}</span></div>
          <div className="truncate text-[12.5px] font-bold">{personalizar(asunto, nombre, vig) || <i className="font-normal text-[#5f6368]">(sin asunto)</i>}</div>
          <div className="truncate text-[11.5px] text-[#5f6368]">{vista || '…'}</div>
        </div>
      </div>
      {/* mensaje abierto */}
      <div className="bg-white p-3.5">
        <h3 className="text-[15px] leading-tight font-semibold">{personalizar(asunto, nombre, vig) || '(sin asunto)'}</h3>
        <div className="mt-2 flex items-center gap-2 text-[11px] text-[#5f6368]">
          <span className="grid h-7 w-7 place-items-center rounded-full bg-[#003760] text-[11px] font-bold text-white">F</span>
          <span className="leading-tight"><b className="text-[#202124]">{EMPRESA}</b><br />para {nombre}</span>
        </div>
        <div className="mt-3 overflow-hidden rounded-lg border border-[#e8eaed]">
          <div className="bg-[#003760] px-4 py-3.5 text-center"><span className="text-[17px] font-extrabold tracking-[0.25em] text-white">{EMPRESA.toUpperCase()}</span></div>
          <div className="space-y-2.5 px-4 py-4 text-[12.5px] leading-relaxed text-[#3c4043]">
            {parrafos.length ? parrafos.map((p, i) => <p key={i} className="whitespace-pre-line">{p}</p>) : <p className="text-[#80868b]">Aquí aparecerá el cuerpo del correo.</p>}
          </div>
          {dest.length > 0 && parrafos.length > 0 && (
            <div className="grid grid-cols-2 gap-2 px-4 pb-4">
              {dest.map((p) => (
                <div key={p.producto_id} className="rounded-lg border border-[#e8eaed] bg-[#f8f9fa] p-2.5">
                  <div className="line-clamp-2 min-h-[2.1em] text-[11.5px] leading-snug font-semibold text-[#202124]">{p.producto}</div>
                  <div className="mt-1 text-[10.5px] text-[#5f6368]">{p.marca}</div>
                  {p.precio_venta > 0 && <div className="mt-1 text-[13px] font-extrabold text-[#0F70FC]">{fmtCop(p.precio_venta)}</div>}
                </div>
              ))}
            </div>
          )}
          {parrafos.length > 0 && <div className="px-4 pb-4 text-center"><span className="inline-block rounded-full bg-[#0F70FC] px-5 py-2 text-[12.5px] font-bold text-white">Visítanos en la tienda</span></div>}
          <div className="border-t border-[#e8eaed] bg-[#f8f9fa] px-4 py-2.5 text-center text-[10px] leading-snug text-[#80868b]">
            Recibes este correo porque autorizaste el tratamiento de tus datos con {EMPRESA}. <u>Cancelar suscripción</u>
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
  return <VigenciaCtx.Provider value={vigencia || base}><Vista {...props} /></VigenciaCtx.Provider>
}

type Props = { mensaje: Partial<Mensaje>; productos: Producto[]; className?: string; canal?: string; onCanal?: (c: string) => void; sinPestanas?: boolean; todos?: boolean }

function Vista({ mensaje, productos, className, canal, onCanal, sinPestanas, todos }: Props) {
  const canales = (mensaje.canales ?? []).filter((c): c is 'whatsapp' | 'sms' | 'email' => c in ICONO)
  const [sel, setSel] = useState<string>('')
  const [nombre, setNombre] = useState('María')
  const idNombre = useId()
  const elegido = canal ?? sel
  const activo = canales.includes(elegido as never) ? elegido : canales[0]
  const t = mensaje.textos ?? {}
  const nombreOk = useMemo(() => nombre.trim().slice(0, 30) || 'María', [nombre])

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
                {c === 'whatsapp' && <WhatsAppVista texto={t.whatsapp?.texto ?? ''} nombre={nombreOk} />}
                {c === 'sms' && <SmsVista texto={t.sms?.texto ?? ''} nombre={nombreOk} />}
                {c === 'email' && <CorreoVista asunto={t.email?.asunto ?? ''} preheader={t.email?.preheader ?? ''} cuerpo={t.email?.cuerpo ?? ''} nombre={nombreOk} productos={productos} />}
              </div>
            ))}
          </div>
        ) : null}
        {!todos && activo === 'whatsapp' && <WhatsAppVista texto={t.whatsapp?.texto ?? ''} nombre={nombreOk} />}
        {!todos && activo === 'sms' && <SmsVista texto={t.sms?.texto ?? ''} nombre={nombreOk} />}
        {!todos && activo === 'email' && <CorreoVista asunto={t.email?.asunto ?? ''} preheader={t.email?.preheader ?? ''} cuerpo={t.email?.cuerpo ?? ''} nombre={nombreOk} productos={productos} />}
      </div>
      <p className="mt-2 text-[11px] text-ink-3">Aproximación de cómo lo verá el cliente: cada aplicación (y cada celular) puede variar un poco el diseño.</p>
    </div>
  )
}
