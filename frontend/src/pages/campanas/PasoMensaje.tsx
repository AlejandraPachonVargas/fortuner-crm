import clsx from 'clsx'
import { Check, ImagePlus, Mail, MessageCircle, MessageSquareText, PenLine, PenSquare, RotateCcw, Settings2, Sparkles, Trash2, Wand2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Badge, Btn, Card, ErrorBox, Notice } from '@/components/ui'
import VistaCanales from '@/components/VistaCanales'
import { api, subirBanner, urlBanner, type Mensaje, type Producto, type Textos } from '@/lib/api'
import { fmtNum } from '@/lib/format'

interface Props {
  mensaje: Mensaje; onChange: (m: Mensaje) => void; productos: Producto[]; temporadaId: string | null
  /** Automatizaciones: sin redacción con IA (no conoce {oferta}), con marcadores propios y la vista previa resuelta. */
  sinIa?: boolean; marcadores?: ReactNode; oferta?: string; vigencia?: string | null
}
// (Automatizaciones todavía no guarda banner ni fotos ocultas en sus ediciones: ahí no se muestra la carga.)

interface Validacion {
  whatsapp?: { caracteres: number; ok: boolean; avisos: string[] }
  sms?: { caracteres: number; codificacion: string; mensajes: number; ok: boolean; avisos: string[] }
  email?: { asunto_caracteres: number; cuerpo_caracteres: number; ok: boolean; avisos: string[] }
}

type Canal = 'whatsapp' | 'sms' | 'email'

const CANALES = [
  { id: 'whatsapp', label: 'WhatsApp', icon: MessageCircle, hint: 'Alta apertura, admite emojis', tile: 'bg-[#dcf8e6] text-[#128c4a]' },
  { id: 'sms', label: 'SMS', icon: MessageSquareText, hint: '160 caracteres por mensaje', tile: 'bg-[#e3eefc] text-[#0F70FC]' },
  { id: 'email', label: 'Correo', icon: Mail, hint: 'Asunto + cuerpo, el más económico', tile: 'bg-[#fdebd8] text-[#b45a0b]' },
] as const

const TONOS = ['Cercano y cálido', 'Urgente', 'Elegante y premium', 'Festivo y alegre', 'Familiar', 'Directo y breve']

const MAX_MB = 8
const TIPOS = ['image/jpeg', 'image/png', 'image/webp']

/** «Imagen del mensaje»: el banner del publicista para WhatsApp y el correo (se ve al instante en la vista previa). */
function CargarBanner({ mensaje, set, productos }: { mensaje: Mensaje; set: (p: Partial<Mensaje>) => void; productos: Producto[] }) {
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<unknown>(null)
  const ocultas = (mensaje.fotos_ocultas ?? []).filter((id) => productos.some((p) => p.producto_id === id)).length
  const elegir = async (f: File | undefined) => {
    if (!f) return
    setErr(null)
    if (!TIPOS.includes(f.type)) { setErr(new Error('Formato no admitido: use JPG, PNG o WebP.')); return }
    if (f.size > MAX_MB * 1024 * 1024) { setErr(new Error(`La imagen pesa más de ${MAX_MB} MB. Exporte una versión más liviana.`)); return }
    setBusy(true)
    try { set({ banner: await subirBanner(f) }) } catch (e) { setErr(e) } finally { setBusy(false); if (input.current) input.current.value = '' }
  }
  const b = mensaje.banner
  return (
    <div className="rounded-2xl border border-dashed border-line-strong p-3.5">
      <div className="mb-2 flex flex-wrap items-baseline gap-x-2">
        <span className="text-[12.5px] font-bold text-ink-2">Imagen del mensaje</span>
        <span className="text-[11.5px] text-ink-3">WhatsApp y correo · JPG, PNG o WebP hasta {MAX_MB} MB · ideal horizontal (1200 × 628 px)</span>
      </div>
      <input ref={input} type="file" accept={TIPOS.join(',')} className="hidden" onChange={(e) => void elegir(e.target.files?.[0])} />
      {b ? (
        <div className="flex items-center gap-3">
          <img src={urlBanner(b.id)} alt="Banner cargado" className="h-16 w-28 shrink-0 rounded-lg border border-line bg-surface-2 object-contain" />
          <div className="min-w-0 flex-1 text-[12px] text-ink-2">
            <div className="truncate font-semibold text-ink" title={b.nombre}>{b.nombre || 'Banner'}</div>
            {b.ancho && b.alto && <div className="text-ink-3 tnum">{b.ancho} × {b.alto} px</div>}
          </div>
          <Btn small variant="ghost" icon={<ImagePlus size={14} />} busy={busy} onClick={() => input.current?.click()}>Cambiar</Btn>
          <Btn small variant="ghost" icon={<Trash2 size={14} />} onClick={() => set({ banner: null })}>Quitar</Btn>
        </div>
      ) : (
        <Btn variant="secondary" icon={<ImagePlus size={15} />} busy={busy} onClick={() => input.current?.click()}>Cargar imagen</Btn>
      )}
      <p className="mt-2 text-[11.5px] text-ink-3">
        {b ? 'Va arriba del mensaje en lugar de la foto del producto. ' : 'Sin imagen se usan las fotos de los productos. '}
        Con la <b>(x)</b> de la vista previa puede quitar cualquier foto.
        {ocultas > 0 && <> {' '}<button type="button" onClick={() => set({ fotos_ocultas: [] })} className="inline-flex items-center gap-1 font-semibold text-brand hover:underline"><RotateCcw size={12} />Mostrar de nuevo {ocultas === 1 ? 'la foto oculta' : `las ${ocultas} fotos ocultas`}</button></>}
      </p>
      {err != null && <div className="mt-2"><ErrorBox error={err} /></div>}
    </div>
  )
}

const area = 'w-full rounded-xl border border-line-strong bg-surface px-3.5 py-2.5 text-[13px] leading-relaxed text-ink outline-none placeholder:text-ink-3 focus:border-brand focus:ring-2 focus:ring-brand/15'

export default function PasoMensaje({ mensaje, onChange, productos, temporadaId, sinIa, marcadores, oferta, vigencia }: Props) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<unknown>(null)
  const [val, setVal] = useState<Validacion>({})
  const [canal, setCanal] = useState<Canal>('whatsapp')
  const set = (p: Partial<Mensaje>) => onChange({ ...mensaje, ...p })
  const setTexto = (c: Canal, patch: Record<string, string>) =>
    set({ textos: { ...mensaje.textos, [c]: { ...(mensaje.textos[c] ?? {}), ...patch } } as Textos })

  // Validación de longitudes sin gastar tokens (con retardo para no llamar en cada tecla).
  useEffect(() => {
    const t = setTimeout(() => {
      api<{ validacion: Validacion }>('/campanas/redaccion/validar', { method: 'POST', body: { textos: mensaje.textos } })
        .then((r) => setVal(r.validacion)).catch(() => undefined)
    }, 500)
    return () => clearTimeout(t)
  }, [mensaje.textos])

  const generar = async () => {
    setBusy(true); setErr(null)
    try {
      const r = await api<{ textos: Textos; tokens: number }>('/campanas/ia/redactar', {
        method: 'POST',
        body: { producto_ids: productos.slice(0, 40).map((p) => p.producto_id), prompt: mensaje.prompt, canales: mensaje.canales, tono: mensaje.tono, temporada_id: temporadaId },
      })
      set({ textos: r.textos, tokens: (mensaje.tokens || 0) + r.tokens })
    } catch (e) { setErr(e) } finally { setBusy(false) }
  }
  const tiene = Boolean(mensaje.textos.whatsapp?.texto || mensaje.textos.sms?.texto || mensaje.textos.email?.cuerpo)
  const ia = mensaje.modo === 'ia' && !sinIa
  const elegidos = CANALES.filter((c) => mensaje.canales.includes(c.id))
  const activo: Canal = elegidos.some((c) => c.id === canal) ? canal : (elegidos[0]?.id ?? 'whatsapp')
  const cuenta = (c: Canal) => {
    if (c === 'whatsapp') return val.whatsapp ? `${fmtNum(val.whatsapp.caracteres)} caracteres` : ''
    if (c === 'sms') return val.sms ? `${val.sms.caracteres} car. · ${val.sms.mensajes} SMS` : ''
    return val.email ? `Asunto ${val.email.asunto_caracteres} · cuerpo ${fmtNum(val.email.cuerpo_caracteres)}` : ''
  }
  const avisos = (val[activo]?.avisos ?? [])
  // Vista previa con {oferta} ya reemplazada (Automatizaciones); {nombre} y {vigencia} los resuelve VistaCanales.
  const vista = useMemo<Mensaje>(() => {
    if (!oferta) return mensaje
    const r = (t?: string) => (t ?? '').replace(/\{oferta\}/gi, oferta)
    const t = mensaje.textos
    return { ...mensaje, textos: {
      ...(t.whatsapp ? { whatsapp: { texto: r(t.whatsapp.texto) } } : {}),
      ...(t.sms ? { sms: { texto: r(t.sms.texto) } } : {}),
      ...(t.email ? { email: { ...t.email, asunto: r(t.email.asunto), preheader: r(t.email.preheader), cuerpo: r(t.email.cuerpo) } } : {}),
    } }
  }, [mensaje, oferta])

  return (
    <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
      <div className="min-w-0 space-y-5">
        <Card icon={<Settings2 size={18} />} title="Configura tu mensaje" subtitle="Cómo lo redactas y por dónde lo difundes">
          <div className="space-y-5">
            {!sinIa && <div role="radiogroup" aria-label="Modo de redacción" className="grid gap-2.5 sm:grid-cols-2">
              {([['ia', Sparkles, 'Redactar con IA', 'Escribe las 3 versiones por ti. Consume tokens.'],
                ['manual', PenLine, 'Mi redacción es la final', 'Escribes tú el texto. No consume tokens.']] as const).map(([id, Icon, t, d]) => (
                <button key={id} type="button" role="radio" aria-checked={mensaje.modo === id} onClick={() => set({ modo: id })}
                  className={clsx('flex items-center gap-3 rounded-2xl border p-3.5 text-left transition',
                    mensaje.modo === id ? 'border-brand bg-brand-soft ring-2 ring-brand/15' : 'border-line hover:border-line-strong hover:bg-surface-hover')}>
                  <span className={clsx('grid h-10 w-10 shrink-0 place-items-center rounded-xl', mensaje.modo === id ? 'bg-brand text-white' : 'bg-surface-2 text-ink-3')}><Icon size={19} /></span>
                  <span><span className="block text-[13.5px] font-bold text-ink">{t}</span><span className="block text-[11.5px] text-ink-3">{d}</span></span>
                </button>
              ))}
            </div>}

            <div>
              <div className="mb-2 text-[12.5px] font-bold text-ink-2">Canales de difusión <span className="font-normal text-ink-3">· cada canal tiene un costo distinto</span></div>
              <div className="grid gap-2.5 sm:grid-cols-3">
                {CANALES.map((c) => {
                  const on = mensaje.canales.includes(c.id)
                  return (
                    <label key={c.id} className={clsx('relative flex cursor-pointer flex-col gap-2 rounded-2xl border p-3.5 transition focus-within:ring-2 focus-within:ring-brand/30',
                      on ? 'border-brand bg-brand-soft/50' : 'border-line hover:border-line-strong hover:bg-surface-hover')}>
                      <input type="checkbox" className="sr-only" checked={on}
                        onChange={(e) => set({ canales: e.target.checked ? [...mensaje.canales, c.id] : mensaje.canales.filter((x) => x !== c.id) })} />
                      <span className="flex items-center justify-between">
                        <span className={clsx('grid h-9 w-9 place-items-center rounded-xl', c.tile)}><c.icon size={18} /></span>
                        <span className={clsx('grid h-5 w-5 place-items-center rounded-full border', on ? 'border-brand bg-brand text-white' : 'border-line-strong')}>{on && <Check size={12} strokeWidth={3.5} />}</span>
                      </span>
                      <span><span className="block text-[13.5px] font-bold text-ink">{c.label}</span><span className="block text-[11.5px] leading-snug text-ink-3">{c.hint}</span></span>
                    </label>
                  )
                })}
              </div>
              {mensaje.canales.length === 0 && <div className="mt-3"><Notice tone="bad">Elige al menos un canal.</Notice></div>}
            </div>
          </div>
        </Card>

        {ia && (
          <Card icon={<Wand2 size={18} />} title="Cuéntale a la IA lo que quieres" subtitle={`Recibe los nombres y precios de tus ${productos.length} producto(s). Nunca datos de clientes.`}>
            <div className="space-y-4">
              <div>
                <textarea aria-label="Tu indicación para la IA" value={mensaje.prompt} maxLength={1500} rows={4} onChange={(e) => set({ prompt: e.target.value })}
                  placeholder="Ej.: Promoción 2x1 en licores este fin de semana por la Feria de Manizales. Tono festivo, que invite a venir a la tienda." className={area} />
                <div className="mt-1 text-right text-[11px] text-ink-3 tnum">{mensaje.prompt.length}/1500</div>
              </div>
              <div>
                <div className="mb-1.5 text-[12.5px] font-bold text-ink-2">Tono <span className="font-normal text-ink-3">· opcional</span></div>
                <div role="radiogroup" aria-label="Tono" className="flex flex-wrap gap-1.5">
                  {TONOS.map((t) => (
                    <button key={t} type="button" role="radio" aria-checked={mensaje.tono === t} onClick={() => set({ tono: mensaje.tono === t ? '' : t })}
                      className={clsx('rounded-full border px-3 py-1 text-[12.5px] font-medium transition', mensaje.tono === t ? 'border-brand bg-brand text-white' : 'border-line-strong text-ink-2 hover:bg-surface-hover')}>{t}</button>
                  ))}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <Btn variant="accent" icon={busy ? undefined : <Sparkles size={15} />} busy={busy} disabled={productos.length === 0} onClick={() => void generar()}>{tiene ? 'Regenerar con IA' : 'Generar mensajes'}</Btn>
                {mensaje.tokens > 0 && <Badge tone="brand" title="Tokens acumulados en esta campaña">{fmtNum(mensaje.tokens)} tokens usados</Badge>}
              </div>
              {err != null && <ErrorBox error={err} onRetry={() => void generar()} />}
            </div>
          </Card>
        )}

        <Card icon={<PenSquare size={18} />} title={ia ? 'Revisa y ajusta' : 'Escribe tu mensaje'}
          subtitle={marcadores ?? <>Usa <code className="rounded bg-surface-2 px-1">{'{nombre}'}</code> para personalizar y <code className="rounded bg-surface-2 px-1">{'{vigencia}'}</code> para las fechas de validez de la oferta.</>}>
          {elegidos.length === 0 ? <p className="text-[13px] text-ink-3">Elige un canal arriba para empezar.</p> : (
            <div className="space-y-4">
              <div role="tablist" aria-label="Canal que estás editando" className="flex gap-1 border-b border-line">
                {elegidos.map((c) => (
                  <button key={c.id} type="button" role="tab" aria-selected={activo === c.id} onClick={() => setCanal(c.id)}
                    className={clsx('-mb-px flex items-center gap-2 border-b-2 px-3.5 py-2 text-[13px] font-semibold transition', activo === c.id ? 'border-brand text-brand' : 'border-transparent text-ink-3 hover:text-ink')}>
                    <c.icon size={15} />{c.label}
                  </button>
                ))}
              </div>

              {activo === 'whatsapp' && (
                <textarea aria-label="Texto de WhatsApp" rows={8} value={mensaje.textos.whatsapp?.texto ?? ''} maxLength={1200} onFocus={() => setCanal('whatsapp')}
                  onChange={(e) => setTexto('whatsapp', { texto: e.target.value })} className={area}
                  placeholder={ia ? 'Aquí aparecerá la versión generada…' : 'Escribe tu mensaje de WhatsApp. Usa *negrita* y _cursiva_ si quieres.'} />
              )}
              {activo === 'sms' && (
                <textarea aria-label="Texto del SMS" rows={4} value={mensaje.textos.sms?.texto ?? ''} maxLength={400}
                  onChange={(e) => setTexto('sms', { texto: e.target.value })} className={area}
                  placeholder={ia ? 'Aquí aparecerá la versión generada…' : 'Ideal: máximo 160 caracteres, sin tildes ni emojis.'} />
              )}
              {activo === 'email' && (
                <div className="space-y-2.5">
                  <input aria-label="Asunto" value={mensaje.textos.email?.asunto ?? ''} maxLength={150} onChange={(e) => setTexto('email', { asunto: e.target.value })} placeholder="Asunto (ideal: máximo 60 caracteres)"
                    className={clsx(area, 'h-10 py-0 font-semibold placeholder:font-normal')} />
                  <input aria-label="Texto de vista previa" value={mensaje.textos.email?.preheader ?? ''} maxLength={200} onChange={(e) => setTexto('email', { preheader: e.target.value })} placeholder="Texto de vista previa (la segunda línea en la bandeja)"
                    className={clsx(area, 'h-10 py-0')} />
                  <textarea aria-label="Cuerpo del correo" rows={9} value={mensaje.textos.email?.cuerpo ?? ''} maxLength={5000} onChange={(e) => setTexto('email', { cuerpo: e.target.value })} className={area}
                    placeholder={ia ? 'Aquí aparecerá la versión generada…' : 'Cuerpo del correo en texto plano. Separa los párrafos con una línea en blanco.'} />
                </div>
              )}

              <div className="flex flex-wrap items-center gap-2 text-[12px] text-ink-3">
                {cuenta(activo) && <Badge tone={val[activo]?.ok === false ? 'warn' : 'neutral'}>{cuenta(activo)}</Badge>}
                {activo === 'sms' && val.sms && <Badge tone={val.sms.ok ? 'good' : 'warn'}>{val.sms.codificacion} · {val.sms.ok ? '1 SMS por cliente' : `${val.sms.mensajes} SMS por cliente`}</Badge>}
              </div>
              {avisos.map((a) => <Notice key={a} tone="warn">{a}</Notice>)}
              {!sinIa && (mensaje.canales.includes('whatsapp') || mensaje.canales.includes('email')) && <CargarBanner mensaje={mensaje} set={set} productos={productos} />}
              {ia && !tiene && <Notice tone="info">Escribe tu indicación y pulsa <b>Generar mensajes</b>: aquí podrás revisar y editar cada versión.</Notice>}
            </div>
          )}
        </Card>
      </div>

      <div className="min-w-0 xl:sticky xl:top-0 xl:max-h-[calc(100vh-8rem)] xl:overflow-y-auto xl:pr-1 scroll-thin">
        <Card title="Así lo verá el cliente" subtitle="Se actualiza mientras escribes">
          <VistaCanales mensaje={vista} productos={productos} vigencia={vigencia} canal={activo} onCanal={(c) => setCanal(c as Canal)}
            onQuitarBanner={sinIa ? undefined : () => set({ banner: null })}
            onOcultarFoto={sinIa ? undefined : (id) => set({ fotos_ocultas: [...new Set([...(mensaje.fotos_ocultas ?? []), id])] })} />
        </Card>
      </div>
    </div>
  )
}
