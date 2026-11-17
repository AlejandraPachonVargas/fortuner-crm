import clsx from 'clsx'
import { ArrowDown, ArrowUp, Bookmark, ChevronLeft, ChevronRight, Download, FilterX, Gift, Mail, Phone, Plus, SlidersHorizontal, Tag, Upload, UserX, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { Desplegable, FiltroActivo, FiltroMenu, type OpcionFiltro } from '@/components/filtros'
import { Badge, Btn, Card, Empty, ErrorBox, SearchInput, Skeleton, Spinner, Stat } from '@/components/ui'
import { descargar } from '@/lib/api'
import { fmtCop, fmtFecha, fmtNum } from '@/lib/format'
import { Anillo, Avatar, Modal, mascara, selectCls, usePermisos } from './comun'
import { HOY_ISO, op, parametros, useCatalogos, useKpis, useLista, useMutar, type FiltrosLista } from './datos'
import ImportarDialog from './ImportarDialog'
import NavClientes from './NavClientes'
import { SEGMENTOS, TONO_SEGMENTO, nombreCompleto, nombreOpcion } from './modelo'
import { PROBLEMAS } from './validacion'

interface Filtros { estado: string[]; segmentos: string[]; consentimiento: string[]; club: string; mascota: string; ciudad: string; completitudMax: number; problema: string; etiqueta: string; vista: string }
const F0: Filtros = { estado: ['activo'], segmentos: [], consentimiento: [], club: '', mascota: '', ciudad: '', completitudMax: 100, problema: '', etiqueta: '', vista: '' }
type Campo = 'nombre' | 'ventaTotal' | 'ultimaCompra' | 'completitud' | 'visitas'
const POR_PAGINA = 25

const VISTAS: { id: string; label: string; filtros: Partial<Filtros> }[] = [
  { id: 'todos', label: 'Todos los activos', filtros: {} },
  { id: 'cumple', label: 'Cumpleaños esta semana', filtros: { vista: 'cumple' } },
  { id: 'sin_celular', label: 'Sin celular válido', filtros: { problema: 'sin_celular' } },
  { id: 'sin_consentimiento', label: 'Sin consentimiento', filtros: { consentimiento: ['sin_registro'] } },
  { id: 'valiosos', label: 'Valiosos con ficha incompleta', filtros: { segmentos: ['campeones', 'leales', 'no_perder'], completitudMax: 70 } },
  { id: 'riesgo', label: 'En riesgo de irse', filtros: { segmentos: ['en_riesgo', 'no_perder'] } },
  { id: 'mascotas', label: 'Con mascotas', filtros: { mascota: 'con' } },
  { id: 'inactivos', label: 'Inactivos y fusionados', filtros: { estado: ['inactivo', 'anonimizado'] } },
]

export default function ClientesLista() {
  const nav = useNavigate()
  const loc = useLocation()
  const [sp, setSp] = useSearchParams()
  const cat = useCatalogos().data
  const kq = useKpis()
  const { editar, eliminar, importar, verContacto } = usePermisos()
  const [q, setQ] = useState('')
  const [qDeb, setQDeb] = useState('')
  const vistaUrl = sp.get('vista') ?? 'todos'
  const [vista, setVista] = useState(vistaUrl)
  const [f, setF] = useState<Filtros>(() => ({ ...F0, ...(VISTAS.find((v) => v.id === vistaUrl)?.filtros ?? {}), club: sp.get('club') ?? '', problema: sp.get('problema') ?? VISTAS.find((v) => v.id === vistaUrl)?.filtros.problema ?? '' }))
  const [orden, setOrden] = useState<{ campo: Campo; dir: 1 | -1 }>({ campo: 'ventaTotal', dir: -1 })
  const [pag, setPag] = useState(0)
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [imp, setImp] = useState(false)
  const [modal, setModal] = useState<'club' | 'etiqueta' | 'guardar' | 'desactivar' | null>(null)
  const [club, setClub] = useState('')
  const [tag, setTag] = useState('')
  const [nombreVista, setNombreVista] = useState('')
  const [msg, setMsg] = useState<string | null>((loc.state as { ok?: string } | null)?.ok ?? null)
  const [exportando, setExportando] = useState(false)
  const [propias, setPropias] = useState<{ id: string; label: string; f: Filtros }[]>(() => { try { return JSON.parse(localStorage.getItem('crm-vistas-clientes-v2') ?? '[]') } catch { return [] } })
  useEffect(() => { const t = setTimeout(() => setQDeb(q), 300); return () => clearTimeout(t) }, [q])
  useEffect(() => { setPag(0) }, [qDeb, f, orden])

  const params: FiltrosLista = useMemo(() => ({ ...f, q: qDeb, orden: orden.campo, dir: orden.dir === 1 ? 'asc' : 'desc', pagina: pag, porPagina: POR_PAGINA }), [f, qDeb, orden, pag])
  const lq = useLista(params)
  const masivo = useMutar(op.masivo)

  const aplicarVista = (id: string) => {
    setVista(id); setSel(new Set())
    const p = propias.find((x) => x.id === id)
    setF(p ? p.f : { ...F0, ...(VISTAS.find((v) => v.id === id)?.filtros ?? {}) })
    setSp(id === 'todos' ? {} : { vista: id })
  }
  const kpi = kq.data
  const pct = (n: number) => `${Math.round((100 * n) / Math.max(1, kpi?.total ?? 1))}%`
  const filas = lq.data?.filas ?? []
  const total = lq.data?.total ?? 0
  const nPag = Math.max(1, Math.ceil(total / POR_PAGINA))
  const todosSel = filas.length > 0 && filas.every((c) => sel.has(c.id))
  const hayFiltros = JSON.stringify(f) !== JSON.stringify({ ...F0, ...(VISTAS.find((v) => v.id === vista)?.filtros ?? {}) }) || !!q
  const afis = cat?.afiliaciones ?? []

  const ordenar = (campo: Campo) => setOrden((o) => (o.campo === campo ? { campo, dir: (-o.dir) as 1 | -1 } : { campo, dir: campo === 'nombre' ? 1 : -1 }))
  const Th = ({ campo, children, cls }: { campo: Campo; children: string; cls?: string }) => (
    <th className={clsx('px-3 py-2.5 font-semibold', cls)} aria-sort={orden.campo === campo ? (orden.dir === 1 ? 'ascending' : 'descending') : 'none'}>
      <button type="button" onClick={() => ordenar(campo)} className="inline-flex items-center gap-1 hover:text-ink">{children}{orden.campo === campo && (orden.dir === 1 ? <ArrowUp size={12} /> : <ArrowDown size={12} />)}</button></th>)

  const exportar = async () => {
    setExportando(true)
    try { await descargar(`/clientes/exportar${parametros({ ...f, q: qDeb })}`, `clientes-${HOY_ISO}.csv`); setMsg(`Exportación lista (hasta 50.000 clientes con los filtros actuales).`) }
    catch (e) { setMsg(e instanceof Error ? e.message : 'No se pudo exportar') } finally { setExportando(false) }
  }
  const guardarVista = () => {
    if (!nombreVista.trim()) return
    const nuevo = [...propias, { id: 'v' + Date.now(), label: nombreVista.trim().slice(0, 30), f }]
    setPropias(nuevo); try { localStorage.setItem('crm-vistas-clientes-v2', JSON.stringify(nuevo)) } catch { /* sin storage */ }
    setModal(null); setNombreVista(''); setMsg('Vista guardada en este navegador.')
  }
  const lote = async (accion: 'club' | 'etiqueta' | 'desactivar', valor = '') => {
    try {
      const r = await masivo.mutateAsync({ ids: [...sel], accion, valor })
      setMsg(accion === 'club' ? `${r.afectados} cliente(s) afiliados (los que ya eran socios o no se pueden editar se omitieron).` : accion === 'etiqueta' ? `Etiqueta agregada a ${r.afectados} cliente(s).` : `${r.afectados} cliente(s) desactivados.`)
      setSel(new Set()); setModal(null); setTag('')
    } catch (e) { setMsg(e instanceof Error ? e.message : 'No se pudo completar') }
  }
  const set = (p: Partial<Filtros>) => setF({ ...f, ...p })

  // ---------------------------------------------------------------- barra de filtros
  const ESTADOS = [{ id: 'activo', label: 'Activos' }, { id: 'inactivo', label: 'Inactivos' }, { id: 'anonimizado', label: 'Anonimizados' }]
  const CONSENT = [{ id: 'si', label: 'Autoriza' }, { id: 'no', label: 'No autoriza' }, { id: 'sin_registro', label: 'Sin registro' }]
  const unoA = (k: 'club' | 'mascota' | 'ciudad' | 'problema') => (v: string[]) => set({ [k]: v[0] ?? '' } as Partial<Filtros>)
  const menus: { clave: string; label: string; opciones: OpcionFiltro[]; valor: string[]; cambiar: (v: string[]) => void; unico?: boolean }[] = [
    { clave: 'estado', label: 'Estado', opciones: ESTADOS, valor: f.estado, cambiar: (v) => set({ estado: v }) },
    { clave: 'consentimiento', label: 'Consentimiento', opciones: CONSENT, valor: f.consentimiento, cambiar: (v) => set({ consentimiento: v }) },
    { clave: 'segmentos', label: 'Segmento', opciones: Object.entries(SEGMENTOS).map(([id, label]) => ({ id, label })), valor: f.segmentos, cambiar: (v) => set({ segmentos: v }) },
    { clave: 'club', label: 'Club', unico: true, opciones: afis.map((a) => ({ id: a.id, label: a.nombre, color: a.color })), valor: f.club ? [f.club] : [], cambiar: unoA('club') },
    { clave: 'mascota', label: 'Mascota', unico: true, valor: f.mascota ? [f.mascota] : [], cambiar: unoA('mascota'),
      opciones: [{ id: 'con', label: 'Con alguna mascota' }, ...(cat?.tiposMascota.filter((t) => t.id !== '01').map((t) => ({ id: t.id, label: t.nombre })) ?? [])] },
    { clave: 'ciudad', label: 'Ciudad', unico: true, valor: f.ciudad ? [f.ciudad] : [], cambiar: unoA('ciudad'), opciones: cat?.ciudades.map((c) => ({ id: c.id, label: c.nombre })) ?? [] },
    { clave: 'problema', label: 'Calidad de datos', unico: true, valor: f.problema ? [f.problema] : [], cambiar: unoA('problema'), opciones: PROBLEMAS.map((p) => ({ id: p.id, label: p.titulo })) },
  ]
  // Pastillas de lo que se aparta del estado normal (ver solo los activos no se muestra como filtro).
  const activos: { clave: string; texto: string; color?: string; quitar: () => void }[] = [
    ...(f.estado.join() === 'activo' ? [] : f.estado.map((id) => ({ clave: `estado-${id}`, texto: `Estado: ${ESTADOS.find((e) => e.id === id)?.label ?? id}`, quitar: () => set({ estado: f.estado.filter((x) => x !== id) }) }))),
    ...menus.filter((m) => m.clave !== 'estado').flatMap((m) => m.valor.map((id) => {
      const o = m.opciones.find((x) => x.id === id)
      return { clave: `${m.clave}-${id}`, texto: `${m.label}: ${o?.label ?? id}`, color: o?.color, quitar: () => m.cambiar(m.valor.filter((x) => x !== id)) }
    })),
    ...(f.etiqueta ? [{ clave: 'etiqueta', texto: `Etiqueta: ${f.etiqueta}`, quitar: () => set({ etiqueta: '' }) }] : []),
    ...(f.completitudMax < 100 ? [{ clave: 'comp', texto: `Ficha completa hasta ${f.completitudMax}%`, quitar: () => set({ completitudMax: 100 }) }] : []),
  ]

  return (
    <div className="mx-auto max-w-[1400px]">
      <NavClientes />
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1 basis-72"><h1 className="text-[24px] font-semibold text-ink">Clientes</h1><p className="text-[13px] text-ink-3">Todos los clientes de ADVANTAGE (POSCLI) con sus compras, clubes y mascotas, en un solo lugar.</p></div>
        <Btn icon={exportando ? <Spinner size={14} /> : <Download size={15} />} disabled={exportando} onClick={() => void exportar()}>Exportar</Btn>
        {importar && <Btn icon={<Upload size={15} />} onClick={() => setImp(true)}>Importar</Btn>}
        {editar && <Btn variant="accent" icon={<Plus size={16} />} onClick={() => nav('/clientes/nuevo')}>Nuevo cliente</Btn>}
      </div>

      <div className="mb-5 grid grid-cols-2 gap-4 md:grid-cols-5">
        {!kpi ? Array.from({ length: 5 }, (_, i) => <Skeleton key={i} h={84} />) : <>
          <Stat label="Clientes activos" value={fmtNum(kpi.total)} sub={`${fmtNum(kpi.compradores)} con compras recientes`} />
          <Stat label="Autorizan datos" value={pct(kpi.consent)} sub={`${fmtNum(kpi.consent)} personas`} tone={kpi.consent / Math.max(1, kpi.total) < 0.5 ? 'warn' : 'good'} />
          <Stat label="Celular válido" value={pct(kpi.cel)} sub={`${fmtNum(kpi.cel)} personas`} tone={kpi.cel / Math.max(1, kpi.total) < 0.5 ? 'warn' : 'good'} />
          <Stat label="Correo válido" value={pct(kpi.mail)} sub={`${fmtNum(kpi.mail)} personas`} />
          <Stat label="Ficha completa (prom.)" value={`${kpi.comp}/100`} tone={kpi.comp < 60 ? 'warn' : 'good'} />
        </>}
      </div>

      <Card pad={false}>
        <div className="space-y-3 border-b border-line p-4">
          <div className="flex flex-wrap items-center gap-2">
            <div className="min-w-60 flex-1"><SearchInput value={q} onChange={setQ} placeholder="Buscar por nombre, documento, tarjeta, celular, correo o mascota…" /></div>
            {hayFiltros && <Btn variant="ghost" icon={<Bookmark size={15} />} onClick={() => setModal('guardar')}>Guardar vista</Btn>}
          </div>
          <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Vistas">
            {[...VISTAS.map((v) => ({ id: v.id, label: v.label })), ...propias.map((p) => ({ id: p.id, label: p.label }))].map((v) => (
              <button key={v.id} type="button" role="tab" aria-selected={vista === v.id} onClick={() => aplicarVista(v.id)}
                className={clsx('rounded-full border px-3 py-1 text-[12.5px] font-semibold transition', vista === v.id ? 'border-brand bg-brand text-white' : 'border-line-strong bg-surface text-ink-2 hover:bg-surface-hover')}>{v.label}</button>))}
          </div>
          {/* Filtros en botones desplegables (mismo diseño que la Analítica de clientes). */}
          <div className="flex flex-wrap items-center gap-2" aria-label="Filtros" role="group">
            <span className="mr-1 inline-flex items-center gap-1.5 pl-1 text-[12.5px] font-semibold text-ink-3"><SlidersHorizontal size={15} />Filtrar</span>
            {menus.map((m) => <FiltroMenu key={m.clave} label={m.label} opciones={m.opciones} unico={m.unico} valor={m.valor} onChange={m.cambiar} neutro={m.clave === 'estado' && f.estado.join() === 'activo'} />)}
            <Desplegable label="Más" activo={!!f.etiqueta || f.completitudMax < 100} n={(f.etiqueta ? 1 : 0) + (f.completitudMax < 100 ? 1 : 0)}
              resumen={f.etiqueta && f.completitudMax === 100 ? `etiqueta ${f.etiqueta}` : !f.etiqueta && f.completitudMax < 100 ? `ficha hasta ${f.completitudMax}%` : null} ancho={280}>
              {() => (
                <div className="space-y-3 p-2">
                  <label className="block text-[12px] font-semibold text-ink-2">Etiqueta
                    <input className={clsx(selectCls, 'mt-1.5 font-normal')} value={f.etiqueta} onChange={(e) => set({ etiqueta: e.target.value })} placeholder="Ej.: VIP" /></label>
                  <label className="block text-[12px] font-semibold text-ink-2">Ficha completa hasta: <b className="text-ink">{f.completitudMax}%</b>
                    <input type="range" min={10} max={100} step={10} value={f.completitudMax} onChange={(e) => set({ completitudMax: Number(e.target.value) })} className="mt-2 block w-full accent-[var(--brand)]" aria-label="Completitud máxima" /></label>
                </div>
              )}
            </Desplegable>
          </div>
          {hayFiltros && (
            <div className="flex flex-wrap items-center gap-1.5">
              {activos.map((a) => <FiltroActivo key={a.clave} texto={a.texto} color={a.color} onQuitar={a.quitar} />)}
              <Btn small variant="ghost" className="ml-auto" icon={<FilterX size={14} />} onClick={() => { setQ(''); aplicarVista(vista) }}>Limpiar filtros</Btn>
            </div>
          )}
        </div>

        {msg && <div className="border-b border-line bg-good-soft px-4 py-2 text-[12.5px] text-good">{msg} <button type="button" className="ml-2 underline" onClick={() => setMsg(null)}>Cerrar</button></div>}
        {sel.size > 0 && (
          <div className="flex flex-wrap items-center gap-2 border-b border-line bg-brand-soft px-4 py-2.5">
            <b className="text-[13px] text-brand">{sel.size} seleccionado(s)</b>
            {editar && <Btn small icon={<Gift size={14} />} onClick={() => { setClub(afis.find((a) => a.activa)?.id ?? ''); setModal('club') }}>Asignar a un club</Btn>}
            {editar && <Btn small icon={<Tag size={14} />} onClick={() => setModal('etiqueta')}>Etiquetar</Btn>}
            {eliminar && <Btn small icon={<UserX size={14} />} onClick={() => setModal('desactivar')}>Desactivar</Btn>}
            <Btn small variant="ghost" icon={<X size={14} />} onClick={() => setSel(new Set())}>Quitar selección</Btn>
          </div>
        )}

        {lq.error ? <div className="p-4"><ErrorBox error={lq.error} onRetry={() => void lq.refetch()} /></div> : lq.isLoading ? <div className="space-y-2 p-4">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} h={44} />)}</div> : filas.length === 0 ? <Empty text="Ningún cliente coincide" hint="Prueba quitando filtros o buscando por otro dato." /> : (
          <>
            <div className={clsx('overflow-x-auto transition-opacity', lq.isFetching && 'opacity-60')}>
              <table className="w-full min-w-[1000px] text-left text-[12.5px]">
                <thead className="border-b border-line bg-surface-2/60 text-[11.5px] tracking-wide text-ink-3 uppercase">
                  <tr>
                    <th className="w-10 px-4 py-2.5"><input type="checkbox" aria-label="Seleccionar la página" checked={todosSel} onChange={(e) => setSel(e.target.checked ? new Set([...sel, ...filas.filter((c) => c.editable).map((c) => c.id)]) : new Set([...sel].filter((x) => !filas.some((c) => c.id === x))))} /></th>
                    <Th campo="nombre">Cliente</Th><th className="px-3 py-2.5 font-semibold">Contacto</th><th className="px-3 py-2.5 font-semibold">Segmento</th>
                    <Th campo="ultimaCompra">Última compra</Th><Th campo="ventaTotal" cls="text-right">Venta total</Th><th className="px-3 py-2.5 font-semibold">Clubes</th><Th campo="completitud" cls="text-center">Ficha</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {filas.map((c) => {
                    const cl = c.clubes.map((id) => afis.find((a) => a.id === id)).filter(Boolean)
                    return (
                      <tr key={c.id} className={clsx('cursor-pointer transition hover:bg-surface-hover/60', sel.has(c.id) && 'bg-brand-soft/40', c.estado !== 'activo' && 'opacity-60')} onClick={() => nav(`/clientes/${encodeURIComponent(c.id)}`)}>
                        <td className="px-4 py-2.5" onClick={(e) => e.stopPropagation()}><input type="checkbox" disabled={!c.editable} aria-label={`Seleccionar ${nombreCompleto(c)}`} checked={sel.has(c.id)} onChange={(e) => { const n = new Set(sel); e.target.checked ? n.add(c.id) : n.delete(c.id); setSel(n) }} /></td>
                        <td className="px-3 py-2.5"><div className="flex items-center gap-3"><Avatar nombre={nombreCompleto(c)} size={34} anonimo={c.estado === 'anonimizado'} />
                          <div className="min-w-0"><div className="truncate font-semibold text-ink">{nombreCompleto(c)}{c.nMascotas > 0 && <span className="ml-1.5 text-[11px] font-medium text-ink-3">· {c.nMascotas} mascota(s)</span>}</div>
                            <div className="text-[11.5px] text-ink-3">{c.tipoDoc} {c.documento}{nombreOpcion(cat?.ciudades, c.ciudadId) ? ` · ${nombreOpcion(cat?.ciudades, c.ciudadId)}` : ''}{c.estado !== 'activo' ? ` · ${c.fusionadoEn ? 'fusionado' : c.estado}` : ''}{!c.editable && c.estado === 'activo' ? ' · solo lectura' : ''}</div></div></div></td>
                        <td className="px-3 py-2.5"><div className="flex items-center gap-1.5"><Phone size={12} className={c.celOk ? 'text-good' : 'text-ink-3'} /><span className={c.celOk ? 'text-ink-2' : 'text-ink-3'}>{c.celular ? mascara(c.celular, verContacto) : '—'}</span></div>
                          <div className="flex items-center gap-1.5"><Mail size={12} className={c.emailOk ? 'text-good' : 'text-ink-3'} /><span className={clsx('max-w-52 truncate', c.emailOk ? 'text-ink-2' : 'text-ink-3')}>{c.email ? mascara(c.email, verContacto) : '—'}</span></div></td>
                        <td className="px-3 py-2.5"><Badge tone={TONO_SEGMENTO[c.segmento] ?? 'neutral'}>{SEGMENTOS[c.segmento] ?? c.segmento}</Badge></td>
                        <td className="px-3 py-2.5 text-ink-2">{c.ultimaCompra ? fmtFecha(c.ultimaCompra) : '—'}</td>
                        <td className="px-3 py-2.5 text-right font-semibold tnum">{c.visitas ? fmtCop(c.ventaTotal) : '—'}</td>
                        <td className="px-3 py-2.5"><div className="flex flex-wrap gap-1">{cl.slice(0, 2).map((a) => <span key={a!.id} className="rounded-full px-2 py-0.5 text-[10.5px] font-bold text-white" style={{ background: a!.color }}>{a!.nombre.replace(/^Club (del )?/, '')}</span>)}{cl.length > 2 && <span className="text-[11px] text-ink-3">+{cl.length - 2}</span>}{cl.length === 0 && <span className="text-ink-3">—</span>}</div></td>
                        <td className="px-3 py-2.5"><div className="flex justify-center"><Anillo valor={c.completitud} size={34} grosor={4} /></div></td>
                      </tr>)
                  })}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap items-center gap-3 border-t border-line px-4 py-3 text-[12.5px] text-ink-3">
              <span>{fmtNum(total)} cliente(s) · mostrando {fmtNum(pag * POR_PAGINA + 1)}–{fmtNum(Math.min(total, (pag + 1) * POR_PAGINA))}</span>
              <div className="ml-auto flex items-center gap-1"><Btn small variant="ghost" disabled={pag === 0} onClick={() => setPag(pag - 1)} icon={<ChevronLeft size={14} />}>Anterior</Btn><span className="px-2 tnum">{fmtNum(pag + 1)} / {fmtNum(nPag)}</span><Btn small variant="ghost" disabled={pag >= nPag - 1} onClick={() => setPag(pag + 1)}>Siguiente<ChevronRight size={14} /></Btn></div>
            </div>
          </>
        )}
      </Card>

      <Modal abierto={modal === 'club'} titulo="Asignar a un club" subtitulo={`${sel.size} cliente(s) seleccionados`} onCerrar={() => setModal(null)}
        pie={<><Btn onClick={() => setModal(null)}>Cancelar</Btn><Btn variant="primary" busy={masivo.isPending} onClick={() => void lote('club', club)}>Afiliar</Btn></>}>
        <select className={selectCls} value={club} onChange={(e) => setClub(e.target.value)} aria-label="Club">{afis.filter((a) => a.activa).map((a) => <option key={a.id} value={a.id}>{a.nombre}</option>)}</select>
        <p className="mt-3 text-[12px] text-ink-3">Se crea la afiliación con carné y vencimiento según la vigencia del club. En los clubes históricos también se marca la bandera de POSCLI que usa la caja.</p>
      </Modal>
      <Modal abierto={modal === 'etiqueta'} titulo="Etiquetar" subtitulo={`${sel.size} cliente(s) seleccionados`} onCerrar={() => setModal(null)}
        pie={<><Btn onClick={() => setModal(null)}>Cancelar</Btn><Btn variant="primary" busy={masivo.isPending} disabled={!tag.trim()} onClick={() => void lote('etiqueta', tag.trim().slice(0, 24))}>Aplicar</Btn></>}>
        <input className="h-9 w-full rounded-lg border border-line-strong bg-surface px-3 text-[13px]" aria-label="Etiqueta" value={tag} onChange={(e) => setTag(e.target.value)} placeholder="Ej.: Feria 2027" maxLength={24} />
      </Modal>
      <Modal abierto={modal === 'desactivar'} titulo="Desactivar clientes" subtitulo={`${sel.size} cliente(s) seleccionados`} onCerrar={() => setModal(null)}
        pie={<><Btn onClick={() => setModal(null)}>Cancelar</Btn><Btn variant="primary" busy={masivo.isPending} onClick={() => void lote('desactivar')}>Desactivar</Btn></>}>
        <p className="text-[13px] text-ink-2">Dejan de aparecer en campañas y en la lista de activos. En el ERP no cambia nada (pueden seguir comprando y acumulando puntos) y se pueden reactivar desde su ficha.</p>
      </Modal>
      <Modal abierto={modal === 'guardar'} titulo="Guardar esta vista" subtitulo="Queda como un botón rápido sobre la tabla (en este navegador)" onCerrar={() => setModal(null)}
        pie={<><Btn onClick={() => setModal(null)}>Cancelar</Btn><Btn variant="primary" disabled={!nombreVista.trim()} onClick={guardarVista}>Guardar</Btn></>}>
        <input className="h-9 w-full rounded-lg border border-line-strong bg-surface px-3 text-[13px]" aria-label="Nombre de la vista" value={nombreVista} onChange={(e) => setNombreVista(e.target.value)} placeholder="Ej.: Campeones de Chinchiná" maxLength={30} />
      </Modal>
      {importar && <ImportarDialog abierto={imp} onCerrar={() => setImp(false)} onHecho={(m) => { setImp(false); setMsg(m) }} />}
    </div>
  )
}
