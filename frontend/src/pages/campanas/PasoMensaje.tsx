import clsx from 'clsx'
import { Mail, MessageCircle, MessageSquareText, PenLine, Sparkles } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Badge, Btn, Card, Chip, ErrorBox, Notice } from '@/components/ui'
import { api, type Mensaje, type Producto, type Textos } from '@/lib/api'
import VistaCanales from '@/components/VistaCanales'
import { CANAL_LABEL, fmtNum } from '@/lib/format'

interface Props { mensaje: Mensaje; onChange: (m: Mensaje) => void; productos: Producto[]; temporadaId: string | null }

interface Validacion {
  whatsapp?: { caracteres: number; ok: boolean; avisos: string[] }
  sms?: { caracteres: number; codificacion: string; mensajes: number; ok: boolean; avisos: string[] }
  email?: { asunto_caracteres: number; cuerpo_caracteres: number; ok: boolean; avisos: string[] }
}

const CANALES = [
  { id: 'whatsapp', label: 'WhatsApp', icon: MessageCircle, hint: 'Mensaje enriquecido, alta apertura' },
  { id: 'sms', label: 'Mensaje de texto (SMS)', icon: MessageSquareText, hint: '160 caracteres por mensaje' },
  { id: 'email', label: 'Correo electrónico', icon: Mail, hint: 'Asunto + cuerpo, el más económico' },
] as const

const TONOS = ['', 'Cercano y cálido', 'Urgente (oferta por tiempo limitado)', 'Elegante y premium', 'Festivo y alegre', 'Familiar', 'Directo y breve']

export default function PasoMensaje({ mensaje, onChange, productos, temporadaId }: Props) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<unknown>(null)
  const [val, setVal] = useState<Validacion>({})
  const set = (p: Partial<Mensaje>) => onChange({ ...mensaje, ...p })
  const setTexto = (canal: 'whatsapp' | 'sms' | 'email', patch: Record<string, string>) =>
    set({ textos: { ...mensaje.textos, [canal]: { ...(mensaje.textos[canal] ?? {}), ...patch } } as Textos })

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
  const ia = mensaje.modo === 'ia'

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div className="space-y-4">
        <Card title="¿Cómo quiere redactar?">
          <div role="radiogroup" aria-label="Modo de redacción" className="grid gap-2 sm:grid-cols-2">
            {([['ia', Sparkles, 'Redactar con IA', 'La IA escribe las 3 versiones según su indicación. Consume tokens.'],
              ['manual', PenLine, 'Mi redacción es la final', 'Escribe usted el texto (p. ej. un publicista). No consume tokens.']] as const).map(([id, Icon, t, d]) => (
              <button key={id} type="button" role="radio" aria-checked={mensaje.modo === id} onClick={() => set({ modo: id })}
                className={clsx('flex items-start gap-3 rounded-xl border p-3 text-left transition', mensaje.modo === id ? 'border-brand bg-brand-soft' : 'border-line-strong hover:bg-surface-hover')}>
                <Icon size={18} className={mensaje.modo === id ? 'text-brand' : 'text-ink-3'} />
                <span><span className="block text-[13px] font-bold text-ink">{t}</span><span className="block text-[11.5px] text-ink-3">{d}</span></span>
              </button>
            ))}
          </div>
        </Card>

        <Card title="Canales de difusión" subtitle="Marque por cuáles quiere difundir (cada canal tiene un costo distinto)">
          <div className="grid gap-2">
            {CANALES.map((c) => (
              <div key={c.id} className="flex items-center gap-3">
                <Chip checked={mensaje.canales.includes(c.id)} onChange={(on) => set({ canales: on ? [...mensaje.canales, c.id] : mensaje.canales.filter((x) => x !== c.id) })}>
                  <c.icon size={14} />{c.label}
                </Chip>
                <span className="text-[11.5px] text-ink-3">{c.hint}</span>
              </div>
            ))}
          </div>
          {mensaje.canales.length === 0 && <div className="mt-3"><Notice tone="bad">Elija al menos un canal.</Notice></div>}
        </Card>

        {ia && (
          <Card title="Indíquele a la IA lo que quiere">
            <div className="space-y-3">
              <label className="block">
                <span className="mb-1 block text-[12px] font-semibold text-ink-2">Su indicación (prompt)</span>
                <textarea value={mensaje.prompt} maxLength={1500} rows={5} onChange={(e) => set({ prompt: e.target.value })}
                  placeholder="Ej.: Promoción 2x1 en licores este fin de semana por la Feria de Manizales. Quiero un tono festivo y que invite a venir a la tienda."
                  className="w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-[13px] leading-relaxed text-ink outline-none placeholder:text-ink-3 focus:border-brand" />
                <span className="mt-1 block text-right text-[11px] text-ink-3 tnum">{mensaje.prompt.length}/1500</span>
              </label>
              <label className="block">
                <span className="mb-1 block text-[12px] font-semibold text-ink-2">Tono</span>
                <select value={mensaje.tono} onChange={(e) => set({ tono: e.target.value })} className="h-9 w-full rounded-lg border border-line-strong bg-surface px-2 text-[13px]">
                  {TONOS.map((t) => <option key={t} value={t}>{t || 'Sin preferencia (la IA decide según el prompt)'}</option>)}
                </select>
              </label>
              <div className="flex flex-wrap items-center gap-3">
                <Btn variant="accent" icon={busy ? undefined : <Sparkles size={15} />} busy={busy} disabled={productos.length === 0} onClick={() => void generar()}>{tiene ? 'Regenerar con IA' : 'Generar mensajes'}</Btn>
                {mensaje.tokens > 0 && <Badge tone="brand" title="Tokens acumulados en esta campaña">{fmtNum(mensaje.tokens)} tokens usados</Badge>}
              </div>
              <p className="text-[11.5px] text-ink-3">La IA recibe los nombres y precios de sus {productos.length} producto(s) y este texto. <b>Nunca</b> se envían datos personales de clientes.</p>
              {err != null && <ErrorBox error={err} onRetry={() => void generar()} />}
            </div>
          </Card>
        )}
        {mensaje.canales.includes('whatsapp') && (
          <Card title="WhatsApp" subtitle={val.whatsapp ? `${fmtNum(val.whatsapp.caracteres)} caracteres` : undefined}
            actions={val.whatsapp && !val.whatsapp.ok ? <Badge tone="warn">Muy largo</Badge> : undefined}>
            <textarea aria-label="Texto de WhatsApp" rows={7} value={mensaje.textos.whatsapp?.texto ?? ''} maxLength={1200}
              onChange={(e) => setTexto('whatsapp', { texto: e.target.value })} placeholder={ia ? 'Aquí aparecerá la versión generada…' : 'Escriba su mensaje de WhatsApp. Use {nombre} para personalizar.'}
              className="w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-[13px] leading-relaxed text-ink outline-none placeholder:text-ink-3 focus:border-brand" />
            {val.whatsapp?.avisos.map((a) => <p key={a} className="mt-2 text-[12px] text-warn">{a}</p>)}
          </Card>
        )}

        {mensaje.canales.includes('sms') && (
          <Card title="Mensaje de texto (SMS)" subtitle={val.sms ? `${val.sms.caracteres} caracteres · ${val.sms.codificacion} · ${val.sms.mensajes} SMS por cliente` : undefined}
            actions={val.sms ? <Badge tone={val.sms.ok ? 'good' : 'warn'}>{val.sms.ok ? '1 SMS' : `${val.sms.mensajes} SMS`}</Badge> : undefined}>
            <textarea aria-label="Texto del SMS" rows={3} value={mensaje.textos.sms?.texto ?? ''} maxLength={400}
              onChange={(e) => setTexto('sms', { texto: e.target.value })} placeholder={ia ? 'Aquí aparecerá la versión generada…' : 'Escriba su SMS (ideal: máximo 160 caracteres, sin tildes ni emojis).'}
              className="w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-[13px] leading-relaxed text-ink outline-none placeholder:text-ink-3 focus:border-brand" />
            {val.sms?.avisos.map((a) => <p key={a} className="mt-2 text-[12px] text-warn">{a}</p>)}
          </Card>
        )}

        {mensaje.canales.includes('email') && (
          <Card title="Correo electrónico" subtitle={val.email ? `Asunto ${val.email.asunto_caracteres} car. · cuerpo ${fmtNum(val.email.cuerpo_caracteres)} car.` : undefined}>
            <div className="space-y-2">
              <input aria-label="Asunto" value={mensaje.textos.email?.asunto ?? ''} maxLength={150} onChange={(e) => setTexto('email', { asunto: e.target.value })} placeholder="Asunto (máx. 60 caracteres ideal)"
                className="h-9 w-full rounded-lg border border-line-strong bg-surface px-3 text-[13px] font-semibold text-ink outline-none placeholder:font-normal placeholder:text-ink-3 focus:border-brand" />
              <input aria-label="Texto de vista previa" value={mensaje.textos.email?.preheader ?? ''} maxLength={200} onChange={(e) => setTexto('email', { preheader: e.target.value })} placeholder="Texto de vista previa (opcional)"
                className="h-9 w-full rounded-lg border border-line-strong bg-surface px-3 text-[13px] text-ink outline-none placeholder:text-ink-3 focus:border-brand" />
              <textarea aria-label="Cuerpo del correo" rows={8} value={mensaje.textos.email?.cuerpo ?? ''} maxLength={5000} onChange={(e) => setTexto('email', { cuerpo: e.target.value })}
                placeholder={ia ? 'Aquí aparecerá la versión generada…' : 'Cuerpo del correo en texto plano. Use {nombre} para personalizar.'}
                className="w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-[13px] leading-relaxed text-ink outline-none placeholder:text-ink-3 focus:border-brand" />
            </div>
            {val.email?.avisos.map((a) => <p key={a} className="mt-2 text-[12px] text-warn">{a}</p>)}
          </Card>
        )}

      </div>

      <div className="min-w-0 space-y-4 xl:sticky xl:top-0 xl:max-h-[calc(100vh-10.5rem)] xl:self-start xl:overflow-y-auto xl:pr-1 scroll-thin">
        <Card title="Así lo verá el cliente" subtitle="Vista previa que se actualiza mientras escribe">
          <VistaCanales mensaje={mensaje} productos={productos} />
        </Card>
        {mensaje.canales.length > 0 && !tiene && ia && (
          <Notice tone="info">Escriba su indicación y pulse <b>Generar mensajes</b>: verá aquí las {mensaje.canales.length} sugerencias ({mensaje.canales.map((c) => CANAL_LABEL[c]).join(', ')}) para revisarlas y editarlas.</Notice>
        )}
        <Notice tone="info">Use <code>{'{nombre}'}</code> para personalizar con el nombre de cada cliente. Incluya siempre cómo darse de baja (p. ej. «Responde NO para dejar de recibir»): es un requisito legal y de los proveedores.</Notice>
      </div>
    </div>
  )
}
