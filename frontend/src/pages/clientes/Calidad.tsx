import clsx from 'clsx'
import { Check, GitMerge, ListChecks, ShieldCheck } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Badge, Btn, Card, Empty, ErrorBox, inputCls, Notice, Skeleton } from '@/components/ui'
import { api } from '@/lib/api'
import { fmtCop, fmtNum } from '@/lib/format'
import { Anillo, Avatar, Modal, Pestanas, mascara, usePermisos } from './comun'
import { op, useCalidad, useDuplicados, useFicha, useMutar, type GrupoDuplicado } from './datos'
import { aDatos } from './FormCliente'
import NavClientes from './NavClientes'
import { nombreCompleto, type Cliente, type DatosCliente, type FilaCliente } from './modelo'
import { PROBLEMAS, celularValido, errorCelular, errorEmail } from './validacion'

const GRAVEDAD = { alta: 'bad', media: 'warn', baja: 'neutral' } as const

export default function Calidad() {
  const nav = useNavigate()
  const q = useCalidad()
  const [tab, setTab] = useState<'cola' | 'duplicados'>('cola')
  const dq = useDuplicados(tab === 'duplicados')
  const d = q.data

  return (
    <div className="mx-auto max-w-[1300px]">
      <NavClientes />
      <div className="mb-5"><h1 className="text-[22px] font-extrabold text-ink">Calidad de datos</h1><p className="text-[13px] text-ink-3">Una base limpia vende más: cada celular o correo que se completa es un cliente al que se le puede escribir. Los cambios se guardan en el ERP.</p></div>
      {q.error ? <ErrorBox error={q.error} onRetry={() => void q.refetch()} /> : !d ? <Skeleton h={220} /> : (
        <div className="mb-5 grid items-stretch gap-5 lg:grid-cols-[320px_minmax(0,1fr)]">
          <Card icon={<ShieldCheck size={18} />} title="Salud de la base">
            <div className="flex items-center gap-4"><Anillo valor={d.prom} size={84} grosor={8} /><div className="text-[12.5px] text-ink-2"><b className="block text-[15px] text-ink">{d.prom >= 80 ? 'Muy buena' : d.prom >= 60 ? 'Aceptable' : 'Necesita trabajo'}</b>Completitud promedio de {fmtNum(d.activos)} clientes activos.</div></div>
            <p className="mt-4 text-[12px] text-ink-3">El puntaje pesa más el celular (20), el correo (15), el consentimiento (15) y el nombre (15).</p>
          </Card>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {PROBLEMAS.map((p) => { const n = d.problemas[p.id] ?? 0; return (
              <button key={p.id} type="button" onClick={() => nav(`/clientes?problema=${p.id}`)} className="card flex flex-col gap-1.5 p-4 text-left transition hover:border-brand">
                <div className="flex items-center gap-2"><span className="text-[12.5px] font-bold text-ink">{p.titulo}</span><span className="ml-auto"><Badge tone={GRAVEDAD[p.gravedad]}>{p.gravedad}</Badge></span></div>
                <div className="text-[24px] leading-none font-extrabold tnum text-ink">{fmtNum(n)}</div>
                <div className="h-1.5 overflow-hidden rounded-full bg-surface-2"><div className={clsx('h-full rounded-full', p.gravedad === 'alta' ? 'bg-bad' : p.gravedad === 'media' ? 'bg-warn' : 'bg-ink-3')} style={{ width: `${(100 * n) / Math.max(1, d.activos)}%` }} /></div>
                <div className="text-[11.5px] text-ink-3">{p.ayuda}</div>
              </button>) })}
          </div>
        </div>
      )}

      <Pestanas valor={tab} onChange={setTab} items={[{ id: 'cola', label: 'Cola de trabajo', icon: <ListChecks size={15} /> }, { id: 'duplicados', label: 'Posibles duplicados', icon: <GitMerge size={15} />, n: dq.data?.total }]} />
      <div className="mt-5">
        {tab === 'cola' ? (d ? <Cola filas={d.cola} /> : <Skeleton h={300} />)
          : dq.error ? <ErrorBox error={dq.error} onRetry={() => void dq.refetch()} /> : !dq.data ? <Skeleton h={300} /> : <Duplicados grupos={dq.data.grupos} clientes={dq.data.clientes} total={dq.data.total} />}
      </div>
    </div>
  )
}

// ------------------------------------------------------------------------------------------ cola de trabajo con edición rápida
function Cola({ filas }: { filas: FilaCliente[] }) {
  const { editar } = usePermisos()
  return (
    <Card title="Clientes que más compran con la ficha incompleta" subtitle="Corrige aquí mismo: son los que más rinde completar primero (se guarda en POSCLI)" pad={false}>
      {filas.length === 0 ? <Empty text="¡Todo al día!" hint="No hay clientes valiosos con la ficha incompleta." /> : (
        <ul className="divide-y divide-line">{filas.map((c) => <FilaCola key={c.id} c={c} editar={editar} />)}</ul>
      )}
    </Card>
  )
}
function FilaCola({ c, editar }: { c: FilaCliente; editar: boolean }) {
  const nav = useNavigate()
  const [cel, setCel] = useState(c.celOk ? c.celular : ''), [mail, setMail] = useState(c.emailOk ? c.email : '')
  const [hecho, setHecho] = useState<string | null>(null)
  const act = useMutar(op.actualizar, { ficha: (_r, v) => v.id })
  const eC = errorCelular(cel), eE = errorEmail(mail)
  const cambios: Partial<DatosCliente> = {}
  if (cel && !eC && celularValido(cel) !== (c.celOk ? c.celular : '')) cambios.celular = cel
  if (mail && !eE && mail.trim().toLowerCase() !== (c.emailOk ? c.email : '')) cambios.email = mail.trim().toLowerCase()
  const guardar = async () => {
    try {
      // La versión se lee justo antes de guardar: si la caja cambió al cliente entretanto, el servidor lo detecta.
      const actual = await api<Cliente>(`/clientes/${encodeURIComponent(c.id)}`)
      await act.mutateAsync({ id: c.id, cambios, version: actual.version }); setHecho('Guardado en el ERP')
    } catch (e) { setHecho(e instanceof Error ? e.message : 'No se pudo guardar') }
  }
  return (
    <li className="flex flex-wrap items-center gap-4 px-5 py-3.5">
      <div className="flex min-w-56 flex-1 basis-56 items-center gap-3"><Avatar nombre={nombreCompleto(c)} size={38} />
        <div className="min-w-0"><button type="button" onClick={() => nav(`/clientes/${encodeURIComponent(c.id)}`)} className="block truncate text-[13.5px] font-bold text-ink hover:text-brand">{nombreCompleto(c)}</button>
          <div className="text-[11.5px] text-ink-3">Compra {fmtCop(c.ventaTotal)} · ficha {c.completitud}/100{!c.celOk && c.celular ? ` · celular actual «${c.celular}» no válido` : ''}</div></div></div>
      {editar ? (
        <>
          <div className="w-40"><input aria-label="Celular" className={clsx(inputCls, eC && 'border-bad')} value={cel} inputMode="tel" placeholder="Celular" onChange={(e) => setCel(e.target.value)} />{eC && <span className="text-[11px] text-bad">{eC}</span>}</div>
          <div className="w-52"><input aria-label="Correo" className={clsx(inputCls, eE && 'border-bad')} value={mail} placeholder="Correo" onChange={(e) => setMail(e.target.value)} />{eE && <span className="text-[11px] text-bad">{eE}</span>}</div>
          <Btn small variant="primary" busy={act.isPending} icon={<Check size={14} />} disabled={!Object.keys(cambios).length} onClick={() => void guardar()}>Guardar</Btn>
          {hecho && <span className={clsx('text-[11.5px]', hecho.startsWith('Guardado') ? 'text-good' : 'text-bad')}>{hecho}</span>}
        </>
      ) : <span className="text-[12px] text-ink-3">Solo lectura</span>}
    </li>
  )
}

// ------------------------------------------------------------------------------------------ duplicados y fusión
function Duplicados({ grupos, clientes, total }: { grupos: GrupoDuplicado[]; clientes: Record<string, FilaCliente>; total: number }) {
  const { fusionar, verContacto, editar } = usePermisos()
  const [g, setG] = useState<GrupoDuplicado | null>(null)
  const descartar = useMutar(op.descartarDuplicado)
  if (grupos.length === 0) return <Card><Empty text="Sin duplicados pendientes" hint="Se buscan coincidencias de documento, celular, correo, y nombre con fecha de nacimiento." /></Card>
  return (
    <div className="space-y-4">
      <Notice tone="info">Fusionar no borra a nadie: la ficha que se retira queda <b>inactiva</b> con la referencia de la fusión, y sus mascotas, clubes, vehículos y notas pasan a la que permanece. Las <b>ventas no se mueven en el ERP</b>: la ficha que permanece suma las compras de ambas. {total > grupos.length && `Se muestran los ${grupos.length} grupos con más ventas de ${fmtNum(total)}.`}</Notice>
      <div className="grid gap-4 lg:grid-cols-2">
        {grupos.map((gr) => {
          const cs = gr.ids.map((id) => clientes[id]).filter(Boolean)
          return (
            <Card key={gr.clave} title={gr.motivo} subtitle={`${cs.length} fichas parecidas`} actions={<Badge tone={gr.motivo === 'Mismo documento' ? 'bad' : 'warn'}>Revisar</Badge>}>
              <ul className="space-y-2.5">{cs.map((c) => (
                <li key={c.id} className="flex items-center gap-3 rounded-xl bg-surface-2 px-3 py-2.5"><Avatar nombre={nombreCompleto(c)} size={34} /><div className="min-w-0 flex-1"><div className="truncate text-[13px] font-semibold text-ink">{nombreCompleto(c)}</div><div className="truncate text-[11.5px] text-ink-3">{c.documento} · tarjeta {c.tarjeta} · {c.celular ? mascara(c.celular, verContacto) : 'sin celular'}</div></div><div className="text-right text-[11.5px] text-ink-3">{c.visitas} visitas<br />{fmtCop(c.ventaTotal)}</div></li>))}</ul>
              <div className="mt-3 flex gap-2">{fusionar ? <Btn small variant="primary" icon={<GitMerge size={14} />} onClick={() => setG(gr)}>Comparar y fusionar</Btn> : <span className="text-[12px] text-ink-3">Solo el administrador fusiona.</span>}
                {editar && <Btn small variant="ghost" busy={descartar.isPending} onClick={() => descartar.mutate(gr.ids)}>No son duplicados</Btn>}</div>
            </Card>)
        })}
      </div>
      {g && <Fusion grupo={g} onCerrar={() => setG(null)} />}
    </div>
  )
}

const CAMPOS_FUSION: { k: keyof DatosCliente; label: string }[] = [
  { k: 'nombre1', label: 'Primer nombre' }, { k: 'nombre2', label: 'Segundo nombre' }, { k: 'apellido1', label: 'Primer apellido' }, { k: 'apellido2', label: 'Segundo apellido' },
  { k: 'celular', label: 'Celular' }, { k: 'email', label: 'Correo' }, { k: 'nacimiento', label: 'Nacimiento' }, { k: 'direccion', label: 'Dirección' },
  { k: 'ciudadId', label: 'Ciudad' }, { k: 'barrioId', label: 'Barrio' }, { k: 'sexo', label: 'Género' }, { k: 'profesionId', label: 'Profesión' }, { k: 'consentimiento', label: 'Consentimiento' },
]

function Fusion({ grupo, onCerrar }: { grupo: GrupoDuplicado; onCerrar: () => void }) {
  const [a, b] = grupo.ids
  const fa = useFicha(a), fb = useFicha(b)
  const [ganador, setGanador] = useState(a)
  const [elegir, setElegir] = useState<Record<string, 'ganador' | 'perdedor'>>({})
  const [err, setErr] = useState('')
  const fus = useMutar(op.fusionar, { ficha: (_r, v) => v.ganador })
  if (!fa.data || !fb.data) return <Modal abierto titulo="Fusionar clientes" onCerrar={onCerrar}><Skeleton h={200} /></Modal>
  const cs = [fa.data, fb.data]
  const g = cs.find((c) => c.id === ganador)!, p = cs.find((c) => c.id !== ganador)!
  const val = (c: Cliente, k: keyof DatosCliente) => String(aDatos(c)[k] ?? '') || '—'
  const diferentes = CAMPOS_FUSION.filter((f) => val(g, f.k) !== val(p, f.k))
  const tomar = Object.entries(elegir).filter(([, v]) => v === 'perdedor').map(([k]) => k)
  const ejecutar = async () => { try { await fus.mutateAsync({ ganador: g.id, perdedor: p.id, tomar }); onCerrar() } catch (e) { setErr(e instanceof Error ? e.message : 'No se pudo fusionar') } }

  return (
    <Modal abierto titulo="Fusionar clientes" subtitulo="Elige qué ficha permanece y qué dato conservar de cada una" onCerrar={onCerrar} ancho="max-w-2xl"
      pie={<><Btn onClick={onCerrar}>Cancelar</Btn><Btn variant="primary" busy={fus.isPending} icon={<GitMerge size={15} />} onClick={() => void ejecutar()}>Fusionar</Btn></>}>
      <div className="space-y-4">
        <div role="radiogroup" aria-label="Ficha que permanece" className="grid gap-2.5 sm:grid-cols-2">
          {cs.map((c) => (
            <button key={c.id} type="button" role="radio" aria-checked={ganador === c.id} onClick={() => { setGanador(c.id); setElegir({}) }}
              className={clsx('rounded-2xl border p-3 text-left transition', ganador === c.id ? 'border-brand bg-brand-soft ring-2 ring-brand/15' : 'border-line hover:bg-surface-hover')}>
              <span className="block text-[11px] font-bold tracking-wide text-ink-3 uppercase">{ganador === c.id ? 'Permanece' : 'Se retira (queda inactivo)'}</span>
              <span className="block truncate text-[13.5px] font-bold text-ink">{nombreCompleto(c)}</span><span className="block text-[11.5px] text-ink-3">{c.documento} · {c.visitas} compras · {c.mascotas.length} mascota(s)</span>
            </button>))}
        </div>
        {diferentes.length > 0 && (
          <div className="overflow-hidden rounded-xl border border-line"><table className="w-full text-[12.5px]"><thead className="bg-surface-2 text-ink-3"><tr><th className="px-3 py-2 text-left">Dato</th><th className="px-3 py-2 text-left">Permanece</th><th className="px-3 py-2 text-left">Se retira</th></tr></thead>
            <tbody className="divide-y divide-line">{diferentes.map((f) => { const sel = elegir[f.k] ?? 'ganador'; return (
              <tr key={f.k}><td className="px-3 py-2 font-semibold text-ink-2">{f.label}</td>
                {(['ganador', 'perdedor'] as const).map((lado) => (
                  <td key={lado} className="px-3 py-2"><label className="flex cursor-pointer items-center gap-2"><input type="radio" name={`f-${f.k}`} checked={sel === lado} onChange={() => setElegir({ ...elegir, [f.k]: lado })} /><span className={clsx('truncate', sel === lado ? 'font-semibold text-ink' : 'text-ink-3')}>{val(lado === 'ganador' ? g : p, f.k)}</span></label></td>))}
              </tr>) })}</tbody></table></div>
        )}
        <div className="rounded-2xl bg-surface-2 p-3.5 text-[12.5px] text-ink-2"><b className="text-ink">Qué pasa al fusionar</b>
          <ul className="mt-1 list-disc space-y-0.5 pl-5"><li>Los datos elegidos de la ficha que se retira se escriben en la que permanece (POSCLI).</li><li>Pasan a la que permanece: {p.mascotas.length} mascota(s), {p.afiliaciones.length} afiliación(es), {p.vehiculos.length} vehículo(s) y las notas.</li><li>{p.documento === g.documento ? 'Las dos fichas tienen el mismo documento: sus compras ya son las mismas y no se duplican.' : `Las ${p.visitas} compras de la que se retira se suman en la ficha que permanece; en el ERP las facturas no se tocan.`}</li><li>La ficha retirada no se borra: queda inactiva con la referencia de la fusión, y todo queda en la auditoría.</li></ul></div>
        {err && <Notice tone="bad">{err}</Notice>}
      </div>
    </Modal>
  )
}
