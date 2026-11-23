import clsx from 'clsx'
import { CheckCircle2, CircleAlert, CircleDashed, Download, FlaskConical, Eye, EyeOff, KeyRound, Mail, MessageCircle, MessageSquareText, Plug, Plus, Save, Trash2, X } from 'lucide-react'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Badge, Btn, Card, ErrorBox, Notice, Skeleton, inputCls } from '@/components/ui'
import { api, useCanalesDisponibles, useGet, useInvalidate, type CampoConfig, type CanalId, type ConfigCanales, type EstadoCanal, type PlantillaMeta } from '@/lib/api'
import { fmtFecha } from '@/lib/format'

const ICONO: Record<CanalId, typeof Mail> = { whatsapp: MessageCircle, email: Mail, sms: MessageSquareText }
const ORDEN: CanalId[] = ['whatsapp', 'email', 'sms']

/** Estado del canal en palabras (el mismo criterio que usa el servidor para habilitarlo en campañas). */
function estadoDe(e: EstadoCanal): { tono: 'good' | 'warn' | 'neutral' | 'bad'; texto: string; icono: ReactNode } {
  if (e.error_secretos) return { tono: 'bad', texto: 'Credenciales ilegibles', icono: <CircleAlert size={13} /> }
  if (e.disponible) return { tono: 'good', texto: 'Listo para usar', icono: <CheckCircle2 size={13} /> }
  if (e.configurado) return { tono: 'neutral', texto: 'Desactivado', icono: <CircleDashed size={13} /> }
  if (e.proveedor) return { tono: 'warn', texto: 'Incompleto', icono: <CircleAlert size={13} /> }
  return { tono: 'neutral', texto: 'Sin configurar', icono: <CircleDashed size={13} /> }
}

/** Pestaña «Canales» de Configuración. */
export function Canales() {
  const q = useGet<ConfigCanales>('/configuracion', { stale: 0 })
  const [canal, setCanal] = useState<CanalId>('whatsapp')
  if (q.error) return <ErrorBox error={q.error} onRetry={() => void q.refetch()} />
  if (!q.data) return <Skeleton h={420} />
  const d = q.data
  const e = d.canales.find((x) => x.canal === canal)!
  return (
    <div className="space-y-5">
      <p className="text-[12.5px] text-ink-3">Un canal solo se puede usar en campañas y automatizaciones cuando está completo y activo.</p>
      <ModoDesarrollo editable={d.puede_editar} />

      <div role="tablist" aria-label="Canal" className="grid gap-3 md:grid-cols-3">
        {ORDEN.map((id) => {
          const x = d.canales.find((c) => c.canal === id)!
          const s = estadoDe(x)
          const I = ICONO[id]
          return (
            <button key={id} role="tab" type="button" aria-selected={canal === id} onClick={() => setCanal(id)}
              className={clsx('flex items-center gap-3 rounded-2xl border p-3.5 text-left transition', canal === id ? 'border-brand bg-brand-soft/60 ring-2 ring-brand/15' : 'border-line bg-surface hover:border-line-strong')}>
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-surface-2 text-brand"><I size={19} /></span>
              <span className="min-w-0 flex-1">
                <span className="block text-[13.5px] font-bold text-ink">{x.nombre}</span>
                <span className="block truncate text-[11.5px] text-ink-3">{x.proveedor ? d.catalogo[id][x.proveedor]?.nombre : 'Sin proveedor'}</span>
              </span>
              <Badge tone={s.tono}>{s.icono}{s.texto}</Badge>
            </button>
          )
        })}
      </div>

      <EditorCanal key={`${canal}-${e.actualizado ?? ''}`} e={e} d={d} />
    </div>
  )
}

/** TEMPORAL: «Modo desarrollo». Encendido, los canales sin configurar se pueden usar (los envíos son simulados). */
function ModoDesarrollo({ editable }: { editable: boolean }) {
  const disp = useCanalesDisponibles()
  const inval = useInvalidate()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<unknown>(null)
  const activo = Boolean(disp.data?.desarrollo)
  const cambiar = async () => {
    setBusy(true); setErr(null)
    try { await api('/configuracion/desarrollo', { method: 'PUT', body: { activo: !activo } }); inval('/configuracion') } catch (e) { setErr(e) } finally { setBusy(false) }
  }
  return (
    <div className={clsx('flex flex-wrap items-center gap-3 rounded-2xl border-2 border-dashed p-3.5', activo ? 'border-warn bg-warn-soft' : 'border-line bg-surface')}>
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-surface-2 text-warn"><FlaskConical size={18} /></span>
      <div className="min-w-0 flex-1 text-[12.5px] text-ink-2">
        <div className="text-[13.5px] font-bold text-ink">Modo desarrollo <Badge tone={activo ? 'warn' : 'neutral'}>{activo ? 'Activo' : 'Apagado'}</Badge> <span className="text-[11px] font-semibold tracking-wide text-ink-3 uppercase">temporal</span></div>
        {activo ? 'Los canales sin configurar se pueden usar en campañas y automatizaciones (los envíos son simulados). Apáguelo antes de conectar los canales reales.'
          : 'Apagado: un canal sin configurar o desactivado no se puede usar para difundir. Enciéndalo para probar campañas sin configurar los canales.'}
        {err != null && <div className="mt-2"><ErrorBox error={err} /></div>}
      </div>
      {editable && <Btn variant={activo ? 'secondary' : 'primary'} busy={busy} disabled={!disp.data} onClick={() => void cambiar()}>{activo ? 'Apagar modo desarrollo' : 'Activar modo desarrollo'}</Btn>}
    </div>
  )
}

// ------------------------------------------------------------------------------------------ editor de un canal
function valoresIniciales(campos: CampoConfig[], datos: Record<string, unknown>) {
  const out: Record<string, unknown> = {}
  for (const c of campos) if (c.tipo !== 'secreto') out[c.clave] = c.fijo ? c.defecto : (datos[c.clave] ?? c.defecto ?? '')
  return out
}

function EditorCanal({ e, d }: { e: EstadoCanal; d: ConfigCanales }) {
  const provs = d.catalogo[e.canal]
  const [prov, setProv] = useState<string>(e.proveedor ?? Object.keys(provs)[0])
  const campos = provs[prov].campos
  const [activo, setActivo] = useState(e.proveedor ? e.activo : true)
  const [datos, setDatos] = useState<Record<string, unknown>>(() => valoresIniciales(campos, e.proveedor === prov ? e.datos : {}))
  const [nuevos, setNuevos] = useState<Record<string, string>>({})
  const [borrar, setBorrar] = useState<string[]>([])
  const [busy, setBusy] = useState<'' | 'guardar' | 'probar' | 'plantillas'>('')
  const [err, setErr] = useState<unknown>(null)
  const [prueba, setPrueba] = useState<{ ok: boolean; detalle: string } | null>(null)
  const [plantillas, setPlantillas] = useState<PlantillaMeta[]>(e.plantillas)
  const inval = useInvalidate()
  const editable = d.puede_editar
  const mismoProv = e.proveedor === prov

  useEffect(() => { setDatos(valoresIniciales(campos, e.proveedor === prov ? e.datos : {})); setNuevos({}); setBorrar([]) }, [prov]) // eslint-disable-line react-hooks/exhaustive-deps

  const sucio = useMemo(() => {
    if (prov !== e.proveedor || activo !== e.activo || Object.keys(nuevos).some((k) => nuevos[k]) || borrar.length) return true
    const ini = valoresIniciales(campos, e.datos)
    return campos.some((c) => c.tipo !== 'secreto' && JSON.stringify(datos[c.clave] ?? '') !== JSON.stringify(ini[c.clave] ?? ''))
  }, [prov, activo, nuevos, borrar, datos, campos, e])

  const guardar = async () => {
    setBusy('guardar'); setErr(null); setPrueba(null)
    try {
      const limpios: Record<string, unknown> = {}
      for (const c of campos) if (c.tipo !== 'secreto' && !c.fijo) limpios[c.clave] = c.tipo === 'numero' && datos[c.clave] !== '' ? Number(datos[c.clave]) : datos[c.clave]
      await api(`/configuracion/canales/${e.canal}`, { method: 'PUT', body: { proveedor: prov, activo, datos: limpios, secretos: nuevos, borrar_secretos: borrar } })
      inval('/configuracion')
    } catch (x) { setErr(x) } finally { setBusy('') }
  }
  const probar = async () => {
    setBusy('probar'); setErr(null); setPrueba(null)
    try { const r = await api<{ ok: boolean; detalle: string }>(`/configuracion/canales/${e.canal}/probar`, { method: 'POST' }); setPrueba(r); inval('/configuracion') }
    catch (x) { setErr(x) } finally { setBusy('') }
  }
  const traerPlantillas = async () => {
    setBusy('plantillas'); setErr(null)
    try { const r = await api<{ plantillas: PlantillaMeta[] }>('/configuracion/canales/whatsapp/plantillas', { method: 'POST' }); setPlantillas(r.plantillas) }
    catch (x) { setErr(x) } finally { setBusy('') }
  }
  const usarPlantilla = (p: PlantillaMeta) => {
    const enc = p.encabezado === 'image' ? 'imagen' : p.encabezado === 'text' ? 'texto' : 'ninguno'
    const actuales = (datos.plantilla_variables as string[] | undefined) ?? []
    const base = ['nombre', 'mensaje', 'vigencia', 'tienda', 'oferta']
    const vars = Array.from({ length: p.variables }, (_, i) => actuales[i] ?? base[i] ?? 'mensaje')
    setDatos({ ...datos, plantilla_nombre: p.nombre, plantilla_idioma: p.idioma, plantilla_encabezado: enc, plantilla_variables: vars })
  }

  const ultimo = e.prueba
  return (
    <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
      <div className="min-w-0 space-y-5">
        <Card title={`${e.nombre}: proveedor`} subtitle={provs[prov].ayuda} icon={<Plug size={18} />}>
          <div role="radiogroup" aria-label="Proveedor" className="grid gap-2 sm:grid-cols-2">
            {Object.entries(provs).map(([id, p]) => (
              <button key={id} type="button" role="radio" aria-checked={prov === id} disabled={!editable} onClick={() => setProv(id)}
                className={clsx('rounded-xl border px-3 py-2.5 text-left text-[12.5px] transition disabled:cursor-default', prov === id ? 'border-brand bg-brand-soft font-semibold text-ink ring-2 ring-brand/15' : 'border-line text-ink-2 hover:border-line-strong')}>{p.nombre}</button>
            ))}
          </div>
          {!mismoProv && e.proveedor && <div className="mt-3"><Notice tone="warn">Al guardar con otro proveedor se descartan las credenciales del anterior.</Notice></div>}
          <label className="mt-4 flex items-center gap-2.5 text-[13px] text-ink-2">
            <input type="checkbox" checked={activo} disabled={!editable} onChange={(x) => setActivo(x.target.checked)} className="h-4 w-4 accent-[var(--brand)]" />
            <span><b className="text-ink">Canal activo.</b> Si lo desactiva, deja de aparecer en campañas y automatizaciones aunque esté completo.</span>
          </label>
        </Card>

        <Card title="Datos de conexión" subtitle="Los campos con * son obligatorios. Las claves se guardan cifradas y nunca se vuelven a mostrar." icon={<KeyRound size={18} />}>
          <div className="grid gap-4 md:grid-cols-2">
            {campos.map((c) => (
              <CampoEditor key={c.clave} c={c} editable={editable} valor={datos[c.clave]} onValor={(v) => setDatos({ ...datos, [c.clave]: v })}
                secreto={mismoProv ? e.secretos[c.clave] : undefined} nuevo={nuevos[c.clave] ?? ''} onNuevo={(v) => setNuevos({ ...nuevos, [c.clave]: v })}
                borrado={borrar.includes(c.clave)} onBorrar={(b) => setBorrar(b ? [...borrar, c.clave] : borrar.filter((x) => x !== c.clave))}
                fuentes={d.fuentes_variable} />
            ))}
          </div>
        </Card>

        {e.canal === 'whatsapp' && (
          <Card title="Plantillas aprobadas en Meta" subtitle="Meta solo permite iniciar conversaciones de marketing con plantillas aprobadas." icon={<MessageCircle size={18} />}
            actions={editable ? <Btn small variant="secondary" icon={<Download size={14} />} busy={busy === 'plantillas'} disabled={sucio || !e.secretos.access_token?.guardado} onClick={() => void traerPlantillas()}>Traer de Meta</Btn> : undefined}>
            {sucio && editable && <p className="mb-2 text-[11.5px] text-ink-3">Guarde los cambios antes de traer las plantillas.</p>}
            {plantillas.length === 0 ? <p className="text-[12.5px] text-ink-3">Aún no se han traído plantillas. Con el token, el identificador de la cuenta y la versión guardados, pulse «Traer de Meta».</p> : (
              <ul className="divide-y divide-line">
                {plantillas.map((p) => (
                  <li key={`${p.nombre}-${p.idioma}`} className="flex flex-wrap items-start gap-3 py-2.5">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2"><b className="text-[13px] text-ink">{p.nombre}</b><span className="text-[11.5px] text-ink-3">{p.idioma} · {p.categoria} · encabezado {p.encabezado} · {p.variables} variable(s)</span>
                        <Badge tone={p.estado === 'APPROVED' ? 'good' : 'warn'}>{p.estado === 'APPROVED' ? 'Aprobada' : p.estado}</Badge></div>
                      {p.cuerpo && <p className="mt-1 line-clamp-2 text-[12px] text-ink-2">{p.cuerpo}</p>}
                    </div>
                    {editable && p.estado === 'APPROVED' && <Btn small variant="ghost" onClick={() => usarPlantilla(p)}>Usar para campañas</Btn>}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        )}
      </div>

      <div className="min-w-0 space-y-4 xl:sticky xl:top-0">
        <Card title="Estado del canal">
          <div className="space-y-3 text-[12.5px] text-ink-2">
            {(() => { const s = estadoDe(e); return <Badge tone={s.tono}>{s.icono}{s.texto}</Badge> })()}
            {e.error_secretos && <Notice tone="bad">{e.error_secretos}</Notice>}
            {e.faltantes.length > 0 && <div><b className="text-ink">Falta:</b><ul className="mt-1 list-disc space-y-0.5 pl-5">{e.faltantes.map((f) => <li key={f}>{f}</li>)}</ul></div>}
            {e.actualizado && <p className="text-[11.5px] text-ink-3">Última modificación: {fmtFecha(e.actualizado.slice(0, 10))} {e.actualizado.slice(11, 16)} · {e.actualizado_por}</p>}
            {ultimo && <Notice tone={ultimo.ok ? 'good' : 'bad'}><b>Última prueba ({fmtFecha(ultimo.fecha.slice(0, 10))} {ultimo.fecha.slice(11, 16)}):</b> {ultimo.detalle}</Notice>}
          </div>
        </Card>
        {editable && (
          <div className="space-y-2.5">
            <Btn variant="primary" className="w-full" icon={<Save size={15} />} busy={busy === 'guardar'} disabled={!sucio} onClick={() => void guardar()}>Guardar cambios</Btn>
            <Btn variant="secondary" className="w-full" icon={<Plug size={15} />} busy={busy === 'probar'} disabled={sucio || !e.configurado} onClick={() => void probar()}>Probar conexión</Btn>
            <p className="text-[11.5px] text-ink-3">{sucio ? 'Hay cambios sin guardar.' : 'La prueba verifica las credenciales con el proveedor sin enviar ningún mensaje.'}</p>
          </div>
        )}
        {prueba && <Notice tone={prueba.ok ? 'good' : 'bad'}>{prueba.detalle}</Notice>}
        {err != null && <ErrorBox error={err} />}
      </div>
    </div>
  )
}

// ------------------------------------------------------------------------------------------ un campo
interface CampoProps {
  c: CampoConfig; editable: boolean; valor: unknown; onValor: (v: unknown) => void
  secreto?: { guardado: boolean; final: string | null }; nuevo: string; onNuevo: (v: string) => void; borrado: boolean; onBorrar: (b: boolean) => void
  fuentes: Record<string, string>
}

function CampoEditor({ c, editable, valor, onValor, secreto, nuevo, onNuevo, borrado, onBorrar, fuentes }: CampoProps) {
  const [ver, setVer] = useState(false)
  const id = `cfg-${c.clave}`
  const etiqueta = <label htmlFor={id} className="mb-1 block text-[12.5px] font-semibold text-ink-2">{c.etiqueta}{c.requerido && <span className="text-bad"> *</span>}</label>
  const ayuda = c.ayuda && <p className="mt-1 text-[11.5px] leading-snug text-ink-3">{c.ayuda}</p>
  const ancho = c.tipo === 'variables' || c.clave === 'cuerpo' || c.tipo === 'secreto' && c.clave === 'access_token'
  if (c.tipo === 'secreto') {
    const guardado = secreto?.guardado && !borrado
    return (
      <div className={clsx(ancho && 'md:col-span-2')}>
        {etiqueta}
        <div className="flex gap-2">
          <div className="relative min-w-0 flex-1">
            <input id={id} type={ver ? 'text' : 'password'} autoComplete="new-password" spellCheck={false} disabled={!editable} value={nuevo} onChange={(x) => onNuevo(x.target.value)}
              placeholder={guardado ? `Guardado (${secreto?.final}). Escriba solo para reemplazarlo` : 'Sin guardar'} className={clsx(inputCls, 'pr-10 font-mono')} />
            {editable && <button type="button" onClick={() => setVer(!ver)} aria-label={ver ? 'Ocultar' : 'Mostrar lo que escribo'} className="absolute top-1/2 right-2 -translate-y-1/2 text-ink-3 hover:text-ink">{ver ? <EyeOff size={16} /> : <Eye size={16} />}</button>}
          </div>
          {editable && secreto?.guardado && (borrado
            ? <Btn small variant="ghost" onClick={() => onBorrar(false)}>Deshacer</Btn>
            : <Btn small variant="ghost" icon={<Trash2 size={14} />} onClick={() => onBorrar(true)}>Borrar</Btn>)}
        </div>
        {borrado && <p className="mt-1 text-[11.5px] text-bad">Se borrará al guardar.</p>}
        {ayuda}
      </div>
    )
  }
  if (c.tipo === 'variables') {
    const lista = Array.isArray(valor) ? (valor as string[]) : []
    return (
      <div className="md:col-span-2">
        {etiqueta}
        <div className="space-y-2">
          {lista.map((v, i) => (
            <div key={i} className="flex items-center gap-2">
              <code className="w-12 shrink-0 rounded bg-surface-2 px-1.5 py-1 text-center text-[12px]">{`{{${i + 1}}}`}</code>
              <select aria-label={`Variable ${i + 1}`} disabled={!editable} value={v} onChange={(x) => onValor(lista.map((y, j) => (j === i ? x.target.value : y)))} className={clsx(inputCls, 'h-9')}>
                {Object.entries(fuentes).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
              {editable && <button type="button" aria-label={`Quitar la variable ${i + 1}`} onClick={() => onValor(lista.filter((_, j) => j !== i))} className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-ink-3 hover:bg-surface-hover hover:text-bad"><X size={15} /></button>}
            </div>
          ))}
          {editable && lista.length < 10 && <Btn small variant="ghost" icon={<Plus size={14} />} onClick={() => onValor([...lista, 'mensaje'])}>Agregar variable</Btn>}
        </div>
        {ayuda}
      </div>
    )
  }
  const comun = { id, disabled: !editable || c.fijo, className: clsx(inputCls, c.fijo && 'opacity-70') }
  return (
    <div className={clsx(ancho && 'md:col-span-2')}>
      {etiqueta}
      {c.tipo === 'opcion' ? (
        <select {...comun} value={String(valor ?? '')} onChange={(x) => onValor(x.target.value)}>
          {Object.entries(c.opciones ?? {}).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
      ) : c.clave === 'cuerpo' ? (
        <textarea id={id} disabled={!editable} rows={3} value={String(valor ?? '')} onChange={(x) => onValor(x.target.value)} spellCheck={false}
          className="w-full rounded-xl border-[1.5px] border-line-strong bg-surface-2 px-3 py-2 font-mono text-[12.5px] text-ink outline-none focus:border-brand" />
      ) : (
        <input {...comun} type={c.tipo === 'numero' ? 'number' : c.tipo === 'email' ? 'email' : c.tipo === 'url' ? 'url' : 'text'}
          inputMode={c.tipo === 'numero' ? 'decimal' : undefined} min={c.minimo ?? undefined} max={c.maximo ?? undefined}
          value={String(valor ?? '')} onChange={(x) => onValor(x.target.value)} spellCheck={false} />
      )}
      {c.fijo && <p className="mt-1 text-[11.5px] text-ink-3">Fijo para este proveedor.</p>}
      {ayuda}
    </div>
  )
}
