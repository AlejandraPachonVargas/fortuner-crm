import clsx from 'clsx'
import { CalendarClock, ChevronDown, Crown, MoonStar, Package, Repeat, Sprout, Gauge, Info, ListOrdered, MessageCircle, Mail, MessageSquareText, PieChart, ShieldAlert, SlidersHorizontal, Sparkles, Target, UserRound, Users, Wallet, Zap } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Badge, Bars, Btn, Card, ChipGroup, ErrorBox, Notice, Seccion, Skeleton } from '@/components/ui'
import { api, useGet, type OpcionesSeg, type Preview, type Producto, type Temporada } from '@/lib/api'
import { CANAL_LABEL, DIAS, fmtCop, fmtNum } from '@/lib/format'

export type FiltrosSeg = Record<string, unknown>
interface Props { filtros: FiltrosSeg; onChange: (f: FiltrosSeg) => void; productos: Producto[]; canales: string[]; temporadaId: string | null; onPreview: (p: Preview | null) => void }

interface Recomendacion {
  fuente: 'ia' | 'datos'; resumen: string; recomendado: FiltrosSeg; razones: string[]; tokens: number
  perfil: { n: number; cohorte: string }
}

/** Configuraciones típicas de marketing de retail (los ids son los de /segmentacion/opciones). */
const ESTRATEGIAS: { id: string; icono: ReactNode; titulo: string; desc: string; filtros: FiltrosSeg }[] = [
  { id: 'recompra', icono: <Repeat size={17} />, titulo: 'Recompra a tiempo', desc: 'Clientes en su ventana de recompra que ya compran esta categoría.',
    filtros: { objetivo: 'equilibrado', ciclo: ['en_ventana', 'atrasado'], afinidad_requerida: ['producto', 'grupo'] } },
  { id: 'reactivar', icono: <MoonStar size={17} />, titulo: 'Reactivar dormidos', desc: 'Buenos clientes que dejaron de venir: en riesgo, hibernando o que no se pueden perder.',
    filtros: { objetivo: 'reactivar', segmentos_rfm: ['no_perder', 'en_riesgo', 'hibernando'], afinidad_requerida: ['producto', 'grupo', 'familia'] } },
  { id: 'vip', icono: <Crown size={17} />, titulo: 'Premiar a los mejores', desc: 'Campeones y leales de valor alto: trato preferente, sin descuento agresivo.',
    filtros: { objetivo: 'premium', segmentos_rfm: ['campeones', 'leales'], valor: ['alto'] } },
  { id: 'rotar', icono: <Package size={17} />, titulo: 'Rotar inventario', desc: 'Quienes responden a descuentos y compran en esta familia o grupo.',
    filtros: { objetivo: 'rotar_inventario', descuento: ['alta', 'media'], afinidad_requerida: ['producto', 'grupo', 'familia'] } },
  { id: 'segunda', icono: <Sprout size={17} />, titulo: 'Segunda compra', desc: 'Clientes nuevos y prometedores: convertir la primera visita en hábito.',
    filtros: { objetivo: 'equilibrado', segmentos_rfm: ['nuevos', 'prometedores'], afinidad_requerida: ['producto', 'grupo', 'familia'] } },
]

const arr = <T,>(f: FiltrosSeg, k: string): T[] => (Array.isArray(f[k]) ? (f[k] as T[]) : [])
const MAPA_EDAD: Record<string, string> = { '18-24': '18–24', '25-34': '25–34', '35-44': '35–44', '45-54': '45–54', '55-64': '55–64', '65+': '65 o más', sin_dato: 'Sin dato', menor: 'Menor de 18' }
const NOMBRE_CLAVE: Record<string, string> = {
  segmentos_rfm: 'Tipo de cliente (RFM)', ciclo: 'Ciclo de compra', sexo: 'Género', edades: 'Edad', clubs: 'Clubes', dias_pref: 'Día de compra',
  franjas: 'Franja horaria', valor: 'Valor del cliente', descuento: 'Sensibilidad a descuentos', afinidad_requerida: 'Afinidad', objetivo: 'Objetivo',
}

function Grupo({ titulo, ayuda, children }: { titulo: string; ayuda?: string; children: ReactNode }) {
  return (
    <div>
      <div className="mb-1.5 flex items-baseline gap-2"><span className="text-[12.5px] font-bold text-ink">{titulo}</span>{ayuda && <span className="text-[11.5px] text-ink-3">{ayuda}</span>}</div>
      {children}
    </div>
  )
}

export default function PasoSegmentacion({ filtros, onChange, productos, canales, temporadaId, onPreview }: Props) {
  const { data: op } = useGet<OpcionesSeg>('/campanas/segmentacion/opciones', { stale: 600_000 })
  const { data: temps } = useGet<{ temporadas: Temporada[] }>('/campanas/temporadas')
  const [prev, setPrev] = useState<Preview | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<unknown>(null)
  const [rec, setRec] = useState<Recomendacion | null>(null)
  const [recBusy, setRecBusy] = useState(false)
  const [recErr, setRecErr] = useState<unknown>(null)
  const [verMuestra, setVerMuestra] = useState(false)
  const req = useRef(0)
  const set = (p: FiltrosSeg) => onChange({ ...filtros, ...p })

  const meses = useMemo(() => {
    const t = temps?.temporadas.find((x) => x.id === temporadaId)
    if (!t) return [] as number[]
    const out = new Set<number>()
    for (let d = new Date(t.inicio + 'T00:00:00'); d <= new Date(t.fin + 'T00:00:00'); d.setDate(d.getDate() + 1)) out.add(d.getMonth() + 1)
    return [...out]
  }, [temps, temporadaId])

  const ids = useMemo(() => productos.map((p) => p.producto_id), [productos])
  const cuerpo = useMemo(() => ({ filtros: { ...filtros, productos: ids, canales, meses_temporada: meses } }), [filtros, ids, canales, meses])
  const clave = JSON.stringify(cuerpo)

  useEffect(() => {
    const id = ++req.current
    setBusy(true); setErr(null)
    const t = setTimeout(() => {
      api<Preview>('/campanas/segmentacion/previsualizar', { method: 'POST', body: cuerpo })
        .then((r) => { if (id === req.current) { setPrev(r); onPreview(r) } })
        .catch((e) => { if (id === req.current) { setErr(e); onPreview(null) } })
        .finally(() => { if (id === req.current) setBusy(false) })
    }, 600)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clave])

  const pedirIA = async () => {
    setRecBusy(true); setRecErr(null)
    try { setRec(await api<Recomendacion>('/campanas/ia/segmentacion/recomendar', { method: 'POST', body: { producto_ids: ids.slice(0, 100), temporada_id: temporadaId } })) }
    catch (e) { setRecErr(e) } finally { setRecBusy(false) }
  }
  const aplicar = () => { if (rec) onChange({ ...filtros, ...rec.recomendado }) }
  const limpiar = () => onChange({ consentimiento: 'estricto', objetivo: 'equilibrado', costos: filtros.costos })

  const r = prev?.resumen
  const nActivos = Object.entries(filtros).filter(([k, v]) => !['costos', 'consentimiento', 'objetivo'].includes(k) && (Array.isArray(v) ? v.length > 0 : v !== '' && v !== 0 && v !== false && v != null)).length
  const costos = (filtros.costos as Record<string, number> | undefined) ?? op?.costos ?? { whatsapp: 120, sms: 45, email: 3 }

  return (
    <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
      {/* ----------------------------------------------------------------- controles */}
      <div className="min-w-0 space-y-5">
        <Card icon={<Sparkles size={18} />} title="Recomendación de la IA" subtitle="Analiza quién compra estos productos y en qué temporada"
          actions={<Btn small variant="accent" icon={recBusy ? undefined : <Sparkles size={14} />} busy={recBusy} onClick={() => void pedirIA()}>{rec ? 'Volver a analizar' : 'Recomendar audiencia'}</Btn>}>
          {recErr != null && <ErrorBox error={recErr} onRetry={() => void pedirIA()} />}
          {!rec && !recBusy && !recErr && <p className="text-[12.5px] text-ink-3">Compara el perfil de los clientes que ya compran estos productos contra toda la base y propone los segmentos con mayor probabilidad de respuesta. Usted decide si la aplica.</p>}
          {recBusy && <Skeleton h={90} />}
          {rec && !recBusy && (
            <div className="space-y-2.5">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={rec.fuente === 'ia' ? 'brand' : 'neutral'}>{rec.fuente === 'ia' ? <><Sparkles size={11} />Análisis con IA</> : 'Análisis de datos'}</Badge>
                <span className="text-[11.5px] text-ink-3">{fmtNum(rec.perfil.n)} clientes {rec.perfil.cohorte === 'compradores' ? 'ya compran estos productos' : 'afines a la categoría'}{rec.tokens > 0 ? ` · ${fmtNum(rec.tokens)} tokens` : ''}</span>
              </div>
              {rec.resumen && <p className="text-[13px] leading-relaxed text-ink-2">{rec.resumen}</p>}
              {Object.keys(rec.recomendado).length === 0 ? <Notice tone="info">No se encontró un perfil que destaque: los compradores se parecen a toda la base. Use los filtros manuales.</Notice> : (
                <>
                  <ul className="space-y-1 text-[12.5px] text-ink-2">
                    {Object.entries(rec.recomendado).map(([k, v]) => (
                      <li key={k}><b className="text-ink">{NOMBRE_CLAVE[k] ?? k}:</b> {Array.isArray(v) ? v.map((x) => (k === 'dias_pref' ? DIAS[Number(x)] : op?.segmentos_rfm[String(x)] ?? op?.ciclo[String(x)] ?? MAPA_EDAD[String(x)] ?? String(x))).join(', ') : op?.objetivos[String(v)] ?? String(v)}</li>
                    ))}
                  </ul>
                  {rec.razones.length > 0 && <details className="text-[12px] text-ink-3"><summary className="cursor-pointer font-semibold">¿Por qué?</summary><ul className="mt-1 list-disc space-y-1 pl-5">{rec.razones.map((x) => <li key={x}>{x}</li>)}</ul></details>}
                  <Btn small variant="primary" icon={<Target size={14} />} onClick={aplicar}>Aplicar esta segmentación</Btn>
                </>
              )}
            </div>
          )}
        </Card>

        <Card icon={<Zap size={18} />} title="Estrategias listas" subtitle="Un clic configura los segmentadores; luego puede afinarlos">
          <div className="grid gap-2 sm:grid-cols-2 2xl:grid-cols-3">
            {ESTRATEGIAS.map((e) => (
              <button key={e.id} type="button" onClick={() => onChange({ consentimiento: filtros.consentimiento ?? 'estricto', costos: filtros.costos, tope_contactos: filtros.tope_contactos, excluir_contactados_dias: '15', ...e.filtros })}
                className="flex items-start gap-2.5 rounded-xl border border-line-strong p-2.5 text-left transition hover:border-brand hover:bg-brand-soft">
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-brand-soft text-brand" aria-hidden>{e.icono}</span>
                <span className="min-w-0"><span className="block text-[12.5px] font-bold text-ink">{e.titulo}</span><span className="block text-[11.5px] leading-snug text-ink-3">{e.desc}</span></span>
              </button>
            ))}
          </div>
        </Card>

        <Card icon={<SlidersHorizontal size={18} />} title="Segmentadores" subtitle={nActivos ? `${nActivos} filtro(s) activo(s)` : 'Sin filtros: se usa todo el que pueda recibir'} actions={nActivos ? <Btn small variant="ghost" onClick={limpiar}>Limpiar</Btn> : undefined}>
          <div className="space-y-2.5">
            <Seccion titulo="Objetivo de la campaña" icono={<Target size={16} />} abierta>
              <Grupo titulo="Cambia cómo se pondera el puntaje">
                <div className="flex flex-wrap gap-1.5">
                  {Object.entries(op?.objetivos ?? {}).map(([id, label]) => (
                    <button key={id} type="button" role="radio" aria-checked={(filtros.objetivo ?? 'equilibrado') === id} onClick={() => set({ objetivo: id })}
                      className={clsx('rounded-full border px-3 py-1.5 text-[12.5px] font-medium transition', (filtros.objetivo ?? 'equilibrado') === id ? 'border-brand bg-brand text-white' : 'border-line-strong bg-surface text-ink-2 hover:bg-surface-hover')}>{label}</button>
                  ))}
                </div>
              </Grupo>
            </Seccion>

            <Seccion titulo="Tipo y momento del cliente" icono={<Users size={16} />} activos={arr(filtros, 'segmentos_rfm').length + arr(filtros, 'ciclo').length}>
              <Grupo titulo="Tipo de cliente (RFM)" ayuda="Recencia, frecuencia y valor de compra">
                <ChipGroup value={arr<string>(filtros, 'segmentos_rfm')} onChange={(v) => set({ segmentos_rfm: v })} options={Object.entries(op?.segmentos_rfm ?? {}).map(([id, label]) => ({ id, label }))} />
              </Grupo>
              <Grupo titulo="Momento de compra" ayuda="Según el ritmo propio de cada cliente">
                <ChipGroup value={arr<string>(filtros, 'ciclo')} onChange={(v) => set({ ciclo: v })} options={Object.entries(op?.ciclo ?? {}).map(([id, label]) => ({ id, label }))} />
              </Grupo>
            </Seccion>

            <Seccion titulo="Afinidad con los productos" icono={<Sparkles size={16} />} activos={arr(filtros, 'afinidad_requerida').length + (Number(filtros.afinidad_minima ?? 0) > 0 ? 1 : 0) + arr(filtros, 'descuento').length}>
              <Grupo titulo="Debe cumplir al menos una">
                <ChipGroup value={arr<string>(filtros, 'afinidad_requerida')} onChange={(v) => set({ afinidad_requerida: v })}
                  options={[{ id: 'producto', label: 'Ya compró estos productos' }, { id: 'grupo', label: 'Compra en el mismo grupo' }, { id: 'familia', label: 'Compra en la misma familia' }, { id: 'marca', label: 'Prefiere estas marcas' }]} />
                <label className="mt-3 flex items-center gap-3 text-[12.5px] text-ink-2">Puntaje mínimo
                  <input type="range" min={0} max={90} step={5} value={Number(filtros.afinidad_minima ?? 0)} onChange={(e) => set({ afinidad_minima: Number(e.target.value) })} className="flex-1 accent-[var(--brand)]" aria-label="Puntaje mínimo" />
                  <b className="w-8 text-right tnum text-ink">{Number(filtros.afinidad_minima ?? 0)}</b>
                </label>
              </Grupo>
              <Grupo titulo="Sensibilidad a descuentos" ayuda="Útil para promociones y rotar inventario">
                <ChipGroup value={arr<string>(filtros, 'descuento')} onChange={(v) => set({ descuento: v })} options={[{ id: 'alta', label: 'Compra con descuento' }, { id: 'media', label: 'Media' }, { id: 'baja', label: 'Paga precio completo' }]} />
              </Grupo>
            </Seccion>

            <Seccion titulo="Perfil del cliente" icono={<UserRound size={16} />} activos={arr(filtros, 'sexo').length + arr(filtros, 'valor').length + arr(filtros, 'edades').length + arr(filtros, 'clubs').length}>
              <div className="grid gap-5 sm:grid-cols-2">
                <Grupo titulo="Género"><ChipGroup value={arr<string>(filtros, 'sexo')} onChange={(v) => set({ sexo: v })} options={[{ id: 'F', label: 'Mujeres' }, { id: 'M', label: 'Hombres' }, { id: 'N', label: 'No registrado' }]} /></Grupo>
                <Grupo titulo="Valor del cliente"><ChipGroup value={arr<string>(filtros, 'valor')} onChange={(v) => set({ valor: v })} options={[{ id: 'alto', label: 'Alto' }, { id: 'medio', label: 'Medio' }, { id: 'bajo', label: 'Bajo' }]} /></Grupo>
              </div>
              <Grupo titulo="Edad"><ChipGroup value={arr<string>(filtros, 'edades')} onChange={(v) => set({ edades: v })} options={(op?.edades ?? []).filter((e) => e !== 'menor').map((id) => ({ id, label: MAPA_EDAD[id] ?? id }))} /></Grupo>
              <Grupo titulo="Clubes del punto de venta"><ChipGroup value={arr<string>(filtros, 'clubs')} onChange={(v) => set({ clubs: v })} options={[{ id: 'vino', label: 'Club Vino' }, { id: 'salud', label: 'Club Salud' }, { id: 'mascotas', label: 'Club Mascotas' }, { id: 'parrilla', label: 'Club Parrilla' }]} /></Grupo>
            </Seccion>

            <Seccion titulo="Hábitos de compra" icono={<CalendarClock size={16} />} activos={arr(filtros, 'dias_pref').length + arr(filtros, 'franjas').length + (filtros.min_visitas ? 1 : 0) + (filtros.max_dias_sin_compra ? 1 : 0) + (filtros.solo_compran_temporada ? 1 : 0)}>
              <Grupo titulo="Día y franja preferidos">
                <div className="space-y-2.5">
                  <ChipGroup value={arr<number>(filtros, 'dias_pref')} onChange={(v) => set({ dias_pref: v })} options={[1, 2, 3, 4, 5, 6, 7].map((d) => ({ id: d, label: DIAS[d] }))} />
                  <ChipGroup value={arr<string>(filtros, 'franjas')} onChange={(v) => set({ franjas: v })} options={[{ id: 'mañana', label: 'Mañana' }, { id: 'tarde', label: 'Tarde' }, { id: 'noche', label: 'Noche' }]} />
                </div>
              </Grupo>
              <Grupo titulo="Frecuencia y recencia">
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="text-[12.5px] text-ink-2">Mínimo de visitas
                    <input inputMode="numeric" value={String(filtros.min_visitas ?? '')} onChange={(e) => set({ min_visitas: e.target.value.replace(/\D/g, '').slice(0, 3) })} placeholder="Sin mínimo" className="mt-1 h-9 w-full rounded-lg border border-line-strong bg-surface px-3 text-[13px]" /></label>
                  <label className="text-[12.5px] text-ink-2">Compró en los últimos (días)
                    <input inputMode="numeric" value={String(filtros.max_dias_sin_compra ?? '')} onChange={(e) => set({ max_dias_sin_compra: e.target.value.replace(/\D/g, '').slice(0, 4) })} placeholder="Sin límite" className="mt-1 h-9 w-full rounded-lg border border-line-strong bg-surface px-3 text-[13px]" /></label>
                </div>
                {meses.length > 0 && (
                  <label className="mt-3 flex items-center gap-2 text-[12.5px] text-ink-2"><input type="checkbox" checked={Boolean(filtros.solo_compran_temporada)} onChange={(e) => set({ solo_compran_temporada: e.target.checked })} /> Solo quienes han comprado en los meses de esta temporada</label>
                )}
              </Grupo>
            </Seccion>

            <Seccion titulo="Reglas de contacto" icono={<ShieldAlert size={16} />} activos={filtros.excluir_contactados_dias ? 1 : 0}>
              <div className="space-y-3 text-[12.5px] text-ink-2">
                <label className="flex items-start gap-2"><input type="checkbox" className="mt-0.5" checked={(filtros.consentimiento ?? 'estricto') === 'estricto'} onChange={(e) => set({ consentimiento: e.target.checked ? 'estricto' : 'incluir_sin_registro' })} />
                  <span>Solo clientes que <b>autorizaron</b> el tratamiento de datos (Ley 1581). Si lo desmarcas se incluyen los que no tienen registro; nunca los que lo negaron.</span></label>
                <label className="flex flex-wrap items-center gap-2">No contactar a quien recibió otra campaña en los últimos
                  <input inputMode="numeric" value={String(filtros.excluir_contactados_dias ?? '')} onChange={(e) => set({ excluir_contactados_dias: e.target.value.replace(/\D/g, '').slice(0, 3) })} placeholder="0" className="h-8 w-16 rounded-lg border border-line-strong bg-surface px-2 text-center text-[12.5px]" /> días</label>
              </div>
            </Seccion>
          </div>
        </Card>

        <Card icon={<Wallet size={18} />} title="Presupuesto" subtitle="Limite cuántas personas contactar y ajuste el costo por mensaje">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-[12.5px] text-ink-2 sm:col-span-2">Máximo de personas a contactar
              <div className="mt-1 flex gap-2">
                <input inputMode="numeric" value={String(filtros.tope_contactos ?? '')} onChange={(e) => set({ tope_contactos: e.target.value.replace(/\D/g, '').slice(0, 7) })} placeholder="Sin tope (todas las que cumplan)" className="h-9 min-w-0 flex-1 rounded-lg border border-line-strong bg-surface px-3 text-[13px]" />
                {r?.corte_recomendado && <Btn small variant="secondary" onClick={() => set({ tope_contactos: String(r.corte_recomendado!.contactos) })}>Usar corte recomendado</Btn>}
              </div>
            </label>
            {canales.map((c) => (
              <label key={c} className="text-[12.5px] text-ink-2">Costo por mensaje · {CANAL_LABEL[c]} (COP)
                <input inputMode="decimal" value={String(costos[c] ?? '')} onChange={(e) => set({ costos: { ...costos, [c]: Number(e.target.value.replace(/[^\d.]/g, '')) || 0 } })} className="mt-1 h-9 w-full rounded-lg border border-line-strong bg-surface px-3 text-[13px] tnum" /></label>
            ))}
            <p className="text-[11.5px] text-ink-3 sm:col-span-2">Los costos son supuestos editables: confírmelos con su proveedor de WhatsApp, SMS y correo. Un cliente con celular recibe por WhatsApp (o SMS si no lo eligió); el correo se suma.</p>
          </div>
        </Card>
      </div>

      {/* ----------------------------------------------------------------- resultado en vivo */}
      {/* En pantallas anchas el resultado queda fijo; si es más alto que la pantalla tiene su propio scroll (si no, no se llegaba al final). */}
      <div className="min-w-0 space-y-5 xl:sticky xl:top-0 xl:max-h-[calc(100vh-8rem)] xl:self-start xl:overflow-y-auto xl:pr-1 scroll-thin">
        {prev?.restricciones.excluye_menores && (
          <Notice tone="warn" icon={<ShieldAlert size={15} className="mt-0.5 shrink-0" />}>
            Hay productos de venta restringida ({prev.restricciones.alcohol_o_tabaco.slice(0, 2).join(', ')}…). Se excluyen automáticamente los menores de 18 años y los clientes sin fecha de nacimiento.
          </Notice>
        )}
        {err != null && <ErrorBox error={err} />}
        <Card title="Audiencia resultante" actions={busy ? <Badge tone="warn">Calculando…</Badge> : undefined}>
          {!r ? <Skeleton h={180} /> : (
            <div className={clsx('space-y-4', busy && 'is-fetching')}>
              <div className="rounded-2xl bg-gradient-to-br from-[#0b1d36] to-[#1c5cab] p-5 text-white">
                <div className="text-[11.5px] font-semibold tracking-wider uppercase opacity-75">Personas a contactar</div>
                <div className="mt-1 text-[40px] leading-none font-extrabold tnum">{fmtNum(r.audiencia)}</div>
                <div className="mt-1.5 text-[12.5px] opacity-80">de {fmtNum(r.base_clientes)} clientes con compras · {fmtNum(r.audiencia_candidata)} cumplen los filtros{r.audiencia_candidata > r.audiencia ? ' (antes del tope)' : ''}</div>
                <div className="mt-4 grid grid-cols-3 gap-3 border-t border-white/15 pt-3.5">
                  <div><div className="text-[11px] opacity-70">Costo estimado</div><div className="text-[17px] font-bold tnum">{fmtCop(r.costo_estimado)}</div></div>
                  <div><div className="text-[11px] opacity-70">Por persona</div><div className="text-[17px] font-bold tnum">{r.audiencia ? fmtCop(r.costo_por_contacto) : '—'}</div></div>
                  <div><div className="text-[11px] opacity-70">Puntaje medio</div><div className="text-[17px] font-bold tnum">{r.puntaje_promedio}<span className="text-[11px] font-normal opacity-70"> /100</span></div></div>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                {Object.entries(r.por_canal).map(([c, n]) => {
                  const I = c === 'whatsapp' ? MessageCircle : c === 'sms' ? MessageSquareText : Mail
                  return <span key={c} className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface-2 px-3 py-1 text-[12px] font-semibold text-ink-2"><I size={13} className="text-brand" />{CANAL_LABEL[c]} <b className="text-ink tnum">{fmtNum(n)}</b></span>
                })}
              </div>
              {r.audiencia === 0 && <Notice tone="bad">Ningún cliente cumple estos filtros. Quite alguno o relaje el consentimiento.</Notice>}
              {r.curva.length > 2 && <Pareto curva={r.curva} corte={r.corte_recomendado} tope={Number(filtros.tope_contactos) || null} />}
              {r.corte_recomendado && r.audiencia_candidata > 200 && (
                <Notice tone="info" icon={<Gauge size={15} className="mt-0.5 shrink-0" />}>
                  <b>Corte recomendado:</b> los primeros {fmtNum(r.corte_recomendado.contactos)} clientes ({r.corte_recomendado.pct_audiencia}% de la audiencia) concentran el {r.corte_recomendado.pct_potencial}% del potencial. El resto aporta muy poco por cada peso gastado.
                </Notice>
              )}
            </div>
          )}
        </Card>

        {r && r.audiencia > 0 && (
          <>
            <Card icon={<PieChart size={18} />} title="Quiénes son" subtitle="Composición de la audiencia elegida">
              <div className="grid gap-5 2xl:grid-cols-2">
                <div><div className="mb-1.5 text-[12px] font-bold text-ink-2">Tipo de cliente</div><Bars rows={r.segmentos_rfm.slice(0, 6).map((s) => ({ label: s.nombre, n: s.n }))} total={r.audiencia} /></div>
                <div><div className="mb-1.5 text-[12px] font-bold text-ink-2">Edad</div><Bars rows={r.edades.map((s) => ({ label: MAPA_EDAD[s.id] ?? s.id, n: s.n }))} total={r.audiencia} /></div>
                <div><div className="mb-1.5 text-[12px] font-bold text-ink-2">Género</div><Bars rows={r.sexo.map((s) => ({ label: s.id === 'F' ? 'Mujeres' : s.id === 'M' ? 'Hombres' : 'No registrado', n: s.n }))} total={r.audiencia} /></div>
                <div><div className="mb-1.5 text-[12px] font-bold text-ink-2">Momento de compra</div><Bars rows={r.ciclo.map((s) => ({ label: s.nombre, n: s.n }))} total={r.audiencia} /></div>
              </div>
            </Card>
            <Card icon={<ListOrdered size={18} />} pad={false} title="Los 25 mejores candidatos" subtitle="Datos personales enmascarados"
              actions={<Btn small variant="secondary" onClick={() => setVerMuestra(!verMuestra)} icon={<ChevronDown size={14} className={verMuestra ? 'rotate-180' : ''} />}>{verMuestra ? 'Ocultar' : 'Ver lista'}</Btn>}>
              {verMuestra && <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-left text-[12px]">
                  <thead className="border-b border-line text-ink-3"><tr><th className="px-4 py-2 font-semibold">Cliente</th><th className="px-2 py-2 font-semibold">Puntaje</th><th className="px-2 py-2 font-semibold">Tipo</th><th className="px-2 py-2 font-semibold">Canales</th><th className="px-2 py-2 pr-4 font-semibold">Por qué</th></tr></thead>
                  <tbody className="divide-y divide-line">
                    {prev?.muestra.map((m, i) => (
                      <tr key={i} className="align-top">
                        <td className="px-4 py-2"><div className="font-semibold text-ink">{m.cliente}</div><div className="text-ink-3">{m.celular} · {m.correo}</div></td>
                        <td className="px-2 py-2 font-bold text-brand tnum">{m.puntaje}</td>
                        <td className="px-2 py-2 text-ink-2">{m.segmento}</td>
                        <td className="px-2 py-2 text-ink-2">{m.canales.map((c) => CANAL_LABEL[c]).join(', ')}</td>
                        <td className="px-2 py-2 pr-4 text-ink-3">{m.motivos.join(' · ')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>}
            </Card>
          </>
        )}
        <p className="flex items-start gap-1.5 text-[11.5px] text-ink-3"><Info size={13} className="mt-px shrink-0" /><span><Users size={12} className="mr-1 inline" />El puntaje (0–100) combina afinidad con los productos, momento de recompra, valor, recencia y estacionalidad. Es un modelo explicable; cuando se registren las respuestas reales de las campañas se reemplazará por un modelo entrenado.</span></p>
      </div>
    </div>
  )
}

/** Curva de concentración (Pareto): qué parte del «potencial» se captura con cada parte de la audiencia. */
function Pareto({ curva, corte, tope }: { curva: { pct_audiencia: number; pct_potencial: number; contactos: number }[]; corte: { pct_audiencia: number; pct_potencial: number } | null; tope: number | null }) {
  const W = 320, H = 150, P = 28
  const x = (v: number) => P + (v / 100) * (W - P - 8)
  const y = (v: number) => H - P - (v / 100) * (H - P - 8)
  const pts = [{ pct_audiencia: 0, pct_potencial: 0 }, ...curva]
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.pct_audiencia).toFixed(1)},${y(p.pct_potencial).toFixed(1)}`).join(' ')
  const total = curva[curva.length - 1]?.contactos ?? 0
  const pTope = tope && total ? Math.min(100, (tope / total) * 100) : null
  return (
    <figure>
      <figcaption className="mb-1 text-[12px] font-bold text-ink-2">¿Cuánto potencial capturo según a cuántos contacte?</figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Curva de concentración del potencial de respuesta" className="w-full">
        {[0, 25, 50, 75, 100].map((t) => (
          <g key={t}><line x1={x(0)} x2={x(100)} y1={y(t)} y2={y(t)} stroke="var(--line)" strokeWidth="1" /><text x={P - 4} y={y(t) + 3} textAnchor="end" fontSize="8" fill="var(--ink-3)">{t}%</text>
            <text x={x(t)} y={H - P + 12} textAnchor="middle" fontSize="8" fill="var(--ink-3)">{t}%</text></g>
        ))}
        <line x1={x(0)} y1={y(0)} x2={x(100)} y2={y(100)} stroke="var(--ink-3)" strokeDasharray="3 3" strokeWidth="1" />
        <path d={`${d} L${x(100)},${y(0)} L${x(0)},${y(0)} Z`} fill="var(--brand)" opacity="0.1" />
        <path d={d} fill="none" stroke="var(--brand)" strokeWidth="2" />
        {corte && <g><circle cx={x(corte.pct_audiencia)} cy={y(corte.pct_potencial)} r="4" fill="var(--good)" /><text x={x(corte.pct_audiencia) + 6} y={y(corte.pct_potencial) + 12} fontSize="8.5" fontWeight="700" fill="var(--good)">corte</text></g>}
        {pTope != null && <line x1={x(pTope)} x2={x(pTope)} y1={y(0)} y2={y(100)} stroke="var(--warn)" strokeWidth="1.5" strokeDasharray="4 2" />}
        <text x={W / 2} y={H - 2} textAnchor="middle" fontSize="8.5" fill="var(--ink-3)">% de la audiencia contactada (de mejor a peor)</text>
      </svg>
      <p className="text-[11px] text-ink-3">Cuanto más se curve hacia arriba, más conviene recortar la audiencia. La diagonal punteada sería contactar al azar.</p>
    </figure>
  )
}
