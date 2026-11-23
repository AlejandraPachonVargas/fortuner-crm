import clsx from 'clsx'
import { CalendarClock, CheckCircle2, Download, FileText, ImagePlus, Play, Save, Search, ShieldCheck, Trash2, Upload } from 'lucide-react'
import { useRef, useState, type ReactNode } from 'react'
import { Badge, Btn, Card, ErrorBox, Notice, Skeleton, inputCls } from '@/components/ui'
import { api, subirArchivo, useConfigGeneral, useConsumo, useGet, useInvalidate, type CampoGeneral, type ConfigGeneral } from '@/lib/api'
import { CANAL_LABEL, fmtCop, fmtFecha, fmtNum } from '@/lib/format'

const fechaHora = (iso?: string | null) => (iso ? `${fmtFecha(iso.slice(0, 10))} ${iso.slice(11, 16)}` : '—')

// ------------------------------------------------------------------------------------------ formulario genérico
function Formulario({ seccion, titulo, subtitulo, icono, despues }: { seccion: string; titulo?: string; subtitulo?: ReactNode; icono?: ReactNode; despues?: ReactNode }) {
  const q = useConfigGeneral()
  if (q.error) return <ErrorBox error={q.error} onRetry={() => void q.refetch()} />
  if (!q.data) return <Skeleton h={280} />
  return <FormularioCargado key={JSON.stringify(q.data.valores[seccion as keyof ConfigGeneral['valores']])} d={q.data} seccion={seccion} titulo={titulo} subtitulo={subtitulo} icono={icono} despues={despues} />
}

function FormularioCargado({ d, seccion, titulo, subtitulo, icono, despues }: { d: ConfigGeneral; seccion: string; titulo?: string; subtitulo?: ReactNode; icono?: ReactNode; despues?: ReactNode }) {
  const esquema = d.esquema[seccion]
  const inicial = d.valores[seccion as keyof ConfigGeneral['valores']] as unknown as Record<string, unknown>
  const [v, setV] = useState<Record<string, unknown>>(inicial)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<unknown>(null)
  const [ok, setOk] = useState(false)
  const inval = useInvalidate()
  const sucio = JSON.stringify(v) !== JSON.stringify(inicial)
  const meta = d.meta[seccion]
  const guardar = async () => {
    setBusy(true); setErr(null); setOk(false)
    try {
      const datos: Record<string, unknown> = {}
      for (const c of esquema.campos) datos[c.clave] = c.tipo === 'numero' && v[c.clave] !== '' && v[c.clave] != null ? Number(v[c.clave]) : v[c.clave]
      await api(`/configuracion/general/${seccion}`, { method: 'PUT', body: datos })
      inval('/configuracion'); inval('/productos'); setOk(true)
    } catch (e) { setErr(e) } finally { setBusy(false) }
  }
  return (
    <Card title={titulo ?? esquema.titulo} subtitle={subtitulo} icon={icono}
      actions={d.puede_editar ? <Btn small variant="primary" icon={<Save size={14} />} busy={busy} disabled={!sucio} onClick={() => void guardar()}>Guardar</Btn> : undefined}>
      <div className="grid gap-4 md:grid-cols-2">
        {esquema.campos.map((c) => <Campo key={c.clave} c={c} valor={v[c.clave]} editable={d.puede_editar} onValor={(x) => { setV({ ...v, [c.clave]: x }); setOk(false) }} />)}
      </div>
      {despues}
      <div className="mt-4 flex flex-wrap items-center gap-2 text-[11.5px] text-ink-3">
        {meta?.actualizado && <span>Última modificación: {fechaHora(meta.actualizado)} · {meta.actualizado_por}</span>}
        {sucio && d.puede_editar && <Badge tone="warn">Cambios sin guardar</Badge>}
        {ok && !sucio && <Badge tone="good"><CheckCircle2 size={12} />Guardado</Badge>}
      </div>
      {err != null && <div className="mt-3"><ErrorBox error={err} /></div>}
    </Card>
  )
}

function Campo({ c, valor, editable, onValor }: { c: CampoGeneral; valor: unknown; editable: boolean; onValor: (v: unknown) => void }) {
  const id = `gen-${c.clave}`
  const ayuda = c.ayuda && <p className="mt-1 text-[11.5px] leading-snug text-ink-3">{c.ayuda}</p>
  if (c.tipo === 'booleano') {
    return (
      <div className="md:col-span-2">
        <label className="flex items-start gap-2.5 text-[13px] text-ink">
          <input id={id} type="checkbox" checked={Boolean(valor)} disabled={!editable} onChange={(e) => onValor(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[var(--brand)]" />
          <span><b>{c.etiqueta}</b>{ayuda}</span>
        </label>
      </div>
    )
  }
  const etiqueta = <label htmlFor={id} className="mb-1 block text-[12.5px] font-semibold text-ink-2">{c.etiqueta}{c.requerido && <span className="text-bad"> *</span>}</label>
  if (c.tipo === 'canales') {
    const lista = Array.isArray(valor) ? (valor as string[]) : []
    return (
      <div>
        {etiqueta}
        <div className="flex flex-wrap gap-3">
          {['whatsapp', 'sms', 'email'].map((k) => (
            <label key={k} className="flex items-center gap-1.5 text-[13px] text-ink-2">
              <input type="checkbox" disabled={!editable} checked={lista.includes(k)} onChange={(e) => onValor(e.target.checked ? [...lista, k] : lista.filter((x) => x !== k))} className="h-4 w-4 accent-[var(--brand)]" />{CANAL_LABEL[k]}
            </label>
          ))}
        </div>
        {ayuda}
      </div>
    )
  }
  if (c.tipo === 'texto_largo') {
    return (
      <div className="md:col-span-2">
        {etiqueta}
        <textarea id={id} rows={3} disabled={!editable} value={String(valor ?? '')} maxLength={2000} onChange={(e) => onValor(e.target.value)}
          className="w-full rounded-xl border-[1.5px] border-line-strong bg-surface-2 px-3 py-2 text-[13px] text-ink outline-none focus:border-brand" />
        {ayuda}
      </div>
    )
  }
  if (c.tipo === 'color') {
    return (
      <div>
        {etiqueta}
        <div className="flex items-center gap-2">
          <input type="color" aria-label={c.etiqueta} disabled={!editable} value={String(valor ?? '#003760')} onChange={(e) => onValor(e.target.value)} className="h-10 w-14 cursor-pointer rounded-lg border border-line-strong bg-surface" />
          <input id={id} disabled={!editable} value={String(valor ?? '')} onChange={(e) => onValor(e.target.value)} className={clsx(inputCls, 'font-mono')} />
        </div>
        {ayuda}
      </div>
    )
  }
  return (
    <div>
      {etiqueta}
      <input id={id} disabled={!editable} value={String(valor ?? '')} onChange={(e) => onValor(e.target.value)}
        type={c.tipo === 'numero' ? 'number' : c.tipo === 'hora' ? 'time' : c.tipo === 'email' ? 'email' : c.tipo === 'url' ? 'url' : 'text'}
        min={c.minimo ?? undefined} max={c.maximo ?? undefined} placeholder={c.tipo === 'url' ? 'https://' : undefined} className={inputCls} />
      {ayuda}
    </div>
  )
}

// ------------------------------------------------------------------------------------------ carga de archivos
function CargarArchivo({ etiqueta, accept, ruta, tipo, onListo, icono = <Upload size={14} /> }: { etiqueta: string; accept: string; ruta: string; tipo?: string; onListo: (r: unknown) => void; icono?: ReactNode }) {
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<unknown>(null)
  const elegir = async (f?: File) => {
    if (!f) return
    setBusy(true); setErr(null)
    try { onListo(await subirArchivo(ruta, f, tipo)) } catch (e) { setErr(e) } finally { setBusy(false); if (input.current) input.current.value = '' }
  }
  return (
    <span className="inline-flex flex-col gap-1">
      <input ref={input} type="file" accept={accept} className="hidden" onChange={(e) => void elegir(e.target.files?.[0])} />
      <Btn small variant="secondary" icon={icono} busy={busy} onClick={() => input.current?.click()}>{etiqueta}</Btn>
      {err != null && <ErrorBox error={err} />}
    </span>
  )
}

// ------------------------------------------------------------------------------------------ Empresa
export function Empresa() {
  const q = useConfigGeneral()
  const inval = useInvalidate()
  const [v, setV] = useState(0)
  const d = q.data
  const e = d?.valores.empresa
  return (
    <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
      <Formulario seccion="empresa" subtitulo="Lo que ven sus clientes en los mensajes, la página de baja y la IA." icono={<ImagePlus size={18} />} />
      <div className="space-y-5">
        <Card title="Logo" subtitle="PNG con fondo transparente (ideal), JPG o WebP; hasta 3 MB.">
          {d?.logo ? <img src={`/media/empresa/logo.webp?v=${v}`} alt="Logo de la empresa" className="mb-3 max-h-24 rounded-lg border border-line bg-surface-2 p-2" />
            : <p className="mb-3 text-[12.5px] text-ink-3">Aún no hay logo: en los mensajes se usa la inicial del nombre.</p>}
          {d?.puede_editar && <div className="flex flex-wrap gap-2">
            <CargarArchivo etiqueta={d.logo ? 'Cambiar logo' : 'Cargar logo'} accept="image/png,image/jpeg,image/webp" ruta="/configuracion/empresa/logo" onListo={() => { setV(Date.now()); inval('/configuracion') }} />
            {d.logo && <Btn small variant="ghost" icon={<Trash2 size={14} />} onClick={() => void api('/configuracion/empresa/logo', { method: 'DELETE' }).then(() => inval('/configuracion'))}>Quitar</Btn>}
          </div>}
        </Card>
        {e && (
          <Card title="Así se ve en el correo">
            <div className="overflow-hidden rounded-lg border border-line">
              <div className="flex items-center justify-center px-4 py-3" style={{ background: e.color }}>
                {d?.logo ? <img src={`/media/empresa/logo.webp?v=${v}`} alt="" className="max-h-10" /> : <span className="text-[15px] font-extrabold tracking-[0.2em] text-white">{e.nombre.toUpperCase()}</span>}
              </div>
              <div className="space-y-2 bg-white px-4 py-3 text-center">
                <span className="inline-block rounded-full px-4 py-1.5 text-[12px] font-bold text-white" style={{ background: e.color }}>{e.tienda_texto}</span>
                <p className="text-[10px] text-[#80868b]">{[e.razon_social || e.nombre, e.nit && `NIT ${e.nit}`, e.direccion, e.ciudad, e.telefono].filter(Boolean).join(' · ')}</p>
              </div>
            </div>
          </Card>
        )}
      </div>
    </div>
  )
}

// ------------------------------------------------------------------------------------------ Legal y RNE
interface EstadoLegal {
  rne: { activo: boolean; canales: string[]; max_dias: number; fecha: string | null; dias: number | null; telefonos: number; correos: number; vencida: boolean; exentos_autorizados: boolean }
  bajas: { por_canal: Record<string, number>; ultimas: { documento: string; canal: string; fecha: string; erp: string }[] }
}

export function LegalRne() {
  const g = useConfigGeneral()
  const est = useGet<EstadoLegal>('/configuracion/legal/estado', { stale: 0 })
  const inval = useInvalidate()
  const [consulta, setConsulta] = useState('')
  const [resp, setResp] = useState<{ valor: string; en: boolean } | null>(null)
  const admin = g.data?.puede_editar
  const r = est.data?.rne
  const consultar = async () => {
    const x = await api<{ en_rne: boolean }>('/configuracion/legal/rne/consultar', { method: 'POST', body: { valor: consulta } })
    setResp({ valor: consulta, en: x.en_rne })
  }
  return (
    <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
      <Formulario seccion="legal" subtitulo="Política de datos, pie del correo, enlace de baja y Registro de Números Excluidos." icono={<ShieldCheck size={18} />} />
      <div className="space-y-5">
        <Card title="Política de Tratamiento de Datos (PDF)" icon={<FileText size={18} />}>
          {g.data?.politica_pdf ? <p className="mb-3 text-[12.5px] text-ink-2">Publicada en <a className="font-semibold text-brand underline" href="/media/legal/politica.pdf" target="_blank" rel="noreferrer">/media/legal/politica.pdf</a>. Se enlaza en el pie del correo y en la página de baja{g.data.valores.legal.politica_url ? ' (si hay un enlace web, se usa el enlace)' : ''}.</p>
            : <p className="mb-3 text-[12.5px] text-ink-3">Si la política no está publicada en la web, cargue el PDF y el CRM la publica.</p>}
          {admin && <div className="flex flex-wrap gap-2">
            <CargarArchivo etiqueta={g.data?.politica_pdf ? 'Reemplazar PDF' : 'Cargar PDF'} accept="application/pdf" tipo="application/pdf" ruta="/configuracion/legal/politica" onListo={() => inval('/configuracion')} />
            {g.data?.politica_pdf && <Btn small variant="ghost" icon={<Trash2 size={14} />} onClick={() => void api('/configuracion/legal/politica', { method: 'DELETE' }).then(() => inval('/configuracion'))}>Quitar</Btn>}
          </div>}
        </Card>

        <Card title="Registro de Números Excluidos (RNE)" icon={<ShieldCheck size={18} />}
          subtitle={<>Descargue el listado en <a href="https://www.tramitescrcom.gov.co" target="_blank" rel="noreferrer" className="text-brand underline">tramitescrcom.gov.co</a> (usuario de empresa) y cárguelo aquí.</>}>
          {!r ? <Skeleton h={80} /> : (
            <div className="space-y-3 text-[12.5px] text-ink-2">
              <div className="flex flex-wrap gap-2">
                <Badge tone={r.activo ? (r.vencida ? 'bad' : 'good') : 'neutral'}>{!r.activo ? 'Desactivado' : r.vencida ? 'Lista vencida: canales bloqueados' : 'Aplicándose'}</Badge>
                {r.fecha && <Badge tone="neutral">Lista del {fechaHora(r.fecha)} ({r.dias === 0 ? 'hoy' : `hace ${r.dias} d`})</Badge>}
              </div>
              <p>{r.fecha ? <>Contiene <b>{fmtNum(r.telefonos)}</b> teléfonos y <b>{fmtNum(r.correos)}</b> correos.</> : 'Aún no se ha cargado ninguna lista.'}</p>
              {r.activo && r.vencida && <Notice tone="bad">La lista tiene más de {r.max_dias} días o no se ha cargado: {r.canales.map((c) => CANAL_LABEL[c]).join(', ')} quedan bloqueados para campañas y automatizaciones hasta actualizarla.</Notice>}
              {admin && <CargarArchivo etiqueta="Cargar lista del RNE (CSV o TXT)" icono={<Download size={14} />} accept=".csv,.txt,text/plain,text/csv" tipo="text/plain" ruta="/configuracion/legal/rne" onListo={() => { inval('/configuracion') }} />}
              <div className="flex gap-2">
                <input aria-label="Teléfono o correo a consultar" value={consulta} onChange={(e) => setConsulta(e.target.value)} placeholder="Consultar un celular o correo" className={inputCls} />
                <Btn small variant="secondary" icon={<Search size={14} />} disabled={consulta.trim().length < 3} onClick={() => void consultar()}>Consultar</Btn>
              </div>
              {resp && <Notice tone={resp.en ? 'warn' : 'good'}>{resp.valor}: {resp.en ? 'está en el RNE (excluido).' : 'no está en la lista cargada.'}</Notice>}
            </div>
          )}
        </Card>

        <Card title="Cancelaciones de suscripción">
          {!est.data ? <Skeleton h={60} /> : (
            <div className="space-y-2 text-[12.5px] text-ink-2">
              <p>{['email', 'sms', 'whatsapp'].map((c) => `${CANAL_LABEL[c]}: ${fmtNum(est.data!.bajas.por_canal[c] ?? 0)}`).join(' · ')}</p>
              {est.data.bajas.ultimas.length > 0 && <ul className="divide-y divide-line">
                {est.data.bajas.ultimas.slice(0, 8).map((b, i) => <li key={i} className="flex justify-between gap-2 py-1.5"><span>{b.documento} · {CANAL_LABEL[b.canal]}</span><span className="text-ink-3">{fechaHora(b.fecha)} · ERP {b.erp === 'ok' ? '✓' : 'pendiente'}</span></li>)}
              </ul>}
              <p className="text-[11.5px] text-ink-3">Quien cancela deja de recibir ese canal al instante. Si la escritura en el ERP está habilitada, también se marca en POSCLI.</p>
            </div>
          )}
        </Card>
      </div>
    </div>
  )
}

// ------------------------------------------------------------------------------------------ Reglas
export function Reglas() {
  return <Formulario seccion="reglas" subtitulo="Valores por defecto que usan las campañas, la segmentación y el descuento sugerido." />
}

// ------------------------------------------------------------------------------------------ Presupuesto
export function Presupuesto() {
  const c = useConsumo()
  return (
    <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_400px]">
      <Formulario seccion="presupuesto" subtitulo="Topes de gasto mensual por canal. Al alcanzar el tope, el canal se bloquea hasta el mes siguiente." />
      <Card title={`Gasto de ${c.data ? c.data.mes : 'este mes'}`} subtitle="Campañas publicadas o programadas y envíos de automatizaciones, al costo por mensaje vigente.">
        {!c.data ? <Skeleton h={120} /> : (
          <div className="space-y-4">
            {(['whatsapp', 'sms', 'email'] as const).map((k) => {
              const x = c.data!.canales[k]
              const pct = Math.min(100, x.pct ?? 0)
              return (
                <div key={k}>
                  <div className="mb-1 flex items-baseline justify-between gap-2 text-[12.5px]">
                    <b className="text-ink">{CANAL_LABEL[k]}</b>
                    <span className="tnum text-ink-2">{fmtCop(x.gastado)}{x.tope ? <> de {fmtCop(x.tope)} ({x.pct} %)</> : ' · sin tope'}</span>
                  </div>
                  {x.tope ? <div className="h-2.5 overflow-hidden rounded-full bg-surface-2"><div className={clsx('h-full rounded-full', x.agotado ? 'bg-bad' : x.alerta ? 'bg-warn' : 'bg-brand')} style={{ width: `${pct}%` }} /></div> : null}
                  {x.agotado ? <p className="mt-1 text-[11.5px] font-semibold text-bad">Tope alcanzado: canal bloqueado este mes.</p>
                    : x.alerta ? <p className="mt-1 text-[11.5px] font-semibold text-warn">Superó el {c.data!.alerta_pct} % del tope. Quedan {fmtCop(x.disponible)}.</p> : null}
                </div>
              )
            })}
          </div>
        )}
      </Card>
    </div>
  )
}

// ------------------------------------------------------------------------------------------ Carga del ERP
export function Etl() {
  const g = useConfigGeneral()
  const inval = useInvalidate()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<unknown>(null)
  const e = g.data?.etl
  const cargar = async () => {
    setBusy(true); setErr(null)
    try { await api('/sistema/etl', { method: 'POST' }); inval('/configuracion'); inval('/sistema') } catch (x) { setErr(x) } finally { setBusy(false) }
  }
  return (
    <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
      <Formulario seccion="etl" subtitulo="Trae cada día las ventas nuevas del ERP y reconstruye el modelo de datos del CRM." icono={<CalendarClock size={18} />} />
      <Card title="Estado de la carga">
        {!e ? <Skeleton h={100} /> : (
          <div className="space-y-2.5 text-[12.5px] text-ink-2">
            {!e.ads_configurado && <Notice tone="warn">El servidor no tiene configurada la conexión al ERP (ADS_DATA_DIRECTORY en .env): la carga automática no se ejecuta.</Notice>}
            <p>{e.estado.corriendo ? <Badge tone="warn">Cargando… {e.estado.mensaje}</Badge> : <Badge tone="neutral">En espera</Badge>}</p>
            <p>Última carga automática: <b>{e.ultima_automatica ? fmtFecha(e.ultima_automatica) : 'nunca'}</b>
              {e.resultado && <> · {e.resultado.ok ? <span className="text-good">correcta</span> : <span className="text-bad">falló ({e.resultado.error})</span>} ({fechaHora(e.resultado.fecha)})</>}</p>
            {e.estado.fin && <p>Última carga (cualquiera): {fechaHora(e.estado.fin)}{e.estado.error ? <span className="text-bad"> · error: {e.estado.error}</span> : ''}</p>}
            <p className="text-[11.5px] text-ink-3">El CRM debe estar encendido a la hora elegida. Si estaba apagado, la carga se hace al encenderlo, siempre que no hayan pasado más de 4 horas.</p>
            {g.data?.puede_editar && <Btn small variant="secondary" icon={<Play size={14} />} busy={busy} disabled={e.estado.corriendo || !e.ads_configurado} onClick={() => void cargar()}>Cargar ahora</Btn>}
            {err != null && <ErrorBox error={err} />}
          </div>
        )}
      </Card>
    </div>
  )
}
