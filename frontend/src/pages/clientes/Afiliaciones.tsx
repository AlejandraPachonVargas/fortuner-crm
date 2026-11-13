import clsx from 'clsx'
import { Database, Gift, Pencil, Plus, Trash2, Users } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Badge, Btn, Card, Empty, ErrorBox, IconBtn, inputCls, Notice, Skeleton } from '@/components/ui'
import { fmtNum } from '@/lib/format'
import { Campo, Modal, usePermisos } from './comun'
import { op, useAfiliaciones, useMutar } from './datos'
import NavClientes from './NavClientes'
import type { Afiliacion } from './modelo'

const COLORES = ['#8b1e3f', '#1f9d6b', '#e08a00', '#c2410c', '#6b4226', '#1c5cab', '#7c3aed', '#be185d', '#0e7490', '#64748b']

export default function Afiliaciones() {
  const nav = useNavigate()
  const q = useAfiliaciones()
  const { editar, eliminar } = usePermisos()
  const [f, setF] = useState<Partial<Afiliacion> | null>(null)
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')
  const guardarA = useMutar(op.afiliacion)
  const borrarA = useMutar(op.borrarAfiliacion)

  const guardar = async () => {
    if (!f?.nombre?.trim() || f.nombre.trim().length < 3) { setErr('El nombre del club es obligatorio (mínimo 3 letras).'); return }
    try {
      await guardarA.mutateAsync({ id: f.id, nombre: f.nombre.trim(), descripcion: f.descripcion ?? '', beneficios: f.beneficios ?? '', color: f.color ?? COLORES[0], activa: f.activa ?? true, vigenciaMeses: f.vigenciaMeses ?? 12 })
      setF(null); setErr('')
    } catch (e) { setErr(e instanceof Error ? e.message : 'No se pudo guardar') }
  }
  const borrar = async (a: Afiliacion) => {
    if (!confirm(`¿Eliminar el club «${a.nombre}»?`)) return
    try { await borrarA.mutateAsync(a.id); setMsg('') } catch (e) { setMsg(`${a.nombre}: ${e instanceof Error ? e.message : 'no se pudo eliminar'}`) }
  }

  return (
    <div className="mx-auto max-w-[1300px]">
      <NavClientes />
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1"><h1 className="text-[22px] font-extrabold text-ink">Afiliaciones y clubes</h1><p className="text-[13px] text-ink-3">Crea los clubes que quieras (tabla CRM_AFILIACION); cada cliente puede pertenecer a varios y las campañas pueden dirigirse a sus socios.</p></div>
        {editar && <Btn variant="accent" icon={<Plus size={16} />} onClick={() => { setF({ color: COLORES[5], activa: true, vigenciaMeses: 12 }); setErr('') }}>Nuevo club</Btn>}
      </div>
      {msg && <div className="mb-4"><Notice tone="bad">{msg}</Notice></div>}
      {q.error ? <ErrorBox error={q.error} onRetry={() => void q.refetch()} /> : !q.data ? <Skeleton h={260} /> : q.data.length === 0 ? <Card><Empty text="Aún no hay clubes" /></Card> : (
        <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {q.data.map((a) => (
            <div key={a.id} className={clsx('card flex flex-col overflow-hidden', !a.activa && 'opacity-70')}>
              <div className="flex items-center gap-3 px-5 py-4 text-white" style={{ background: `linear-gradient(135deg, ${a.color}, ${a.color}cc)` }}>
                <span className="grid h-10 w-10 place-items-center rounded-xl bg-white/20"><Gift size={20} /></span>
                <div className="min-w-0 flex-1"><div className="truncate text-[16px] font-extrabold">{a.nombre}</div><div className="text-[12px] opacity-85">{a.activa ? `Vigencia ${a.vigenciaMeses} meses` : 'Club inactivo'}</div></div>
              </div>
              <div className="flex-1 space-y-2 px-5 py-4">
                <p className="text-[12.5px] text-ink-2">{a.descripcion || 'Sin descripción'}</p>
                {a.beneficios && <p className="rounded-lg bg-surface-2 px-3 py-2 text-[12px] text-ink-3"><b className="text-ink-2">Beneficios:</b> {a.beneficios}</p>}
                {a.campoPoscli && !a.descripcion.includes(a.campoPoscli) && <p className="flex items-center gap-1.5 text-[11.5px] text-ink-3"><Database size={12} />Club histórico del POS: se sincroniza con la bandera <b>{a.campoPoscli}</b> de POSCLI.</p>}
              </div>
              <div className="flex items-center gap-3 border-t border-line px-5 py-3">
                <button type="button" onClick={() => nav(`/clientes?club=${a.id}`)} className="flex items-center gap-1.5 text-[13px] font-bold text-ink hover:text-brand"><Users size={15} />{fmtNum(a.socios)} socio(s)</button>
                <Badge tone="good">{fmtNum(a.sociosActivos)} activos</Badge>
                {editar && <div className="ml-auto flex"><IconBtn title="Editar" onClick={() => { setF(a); setErr('') }}><Pencil size={15} /></IconBtn>
                  {eliminar && !a.campoPoscli && <IconBtn title="Eliminar" danger onClick={() => void borrar(a)}><Trash2 size={15} /></IconBtn>}</div>}
              </div>
            </div>
          ))}
        </div>
      )}
      <p className="mt-5 text-[12px] text-ink-3">Un club con socios o un club histórico del POS no se elimina (protege el historial y los descuentos de la caja): se desactiva y deja de ofrecerse.</p>

      <Modal abierto={!!f} titulo={f?.id ? 'Editar club' : 'Nuevo club'} onCerrar={() => setF(null)} pie={<><Btn onClick={() => setF(null)}>Cancelar</Btn><Btn variant="primary" busy={guardarA.isPending} onClick={() => void guardar()}>Guardar</Btn></>}>
        {f && (
          <div className="space-y-4">
            <Campo etiqueta="Nombre del club" requerido error={err}><input className={inputCls} value={f.nombre ?? ''} maxLength={40} onChange={(e) => setF({ ...f, nombre: e.target.value })} placeholder="Ej.: Club Repostería" /></Campo>
            <Campo etiqueta="Descripción"><input className={inputCls} value={f.descripcion ?? ''} maxLength={120} onChange={(e) => setF({ ...f, descripcion: e.target.value })} /></Campo>
            <Campo etiqueta="Beneficios"><textarea rows={2} className="w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-[13px] outline-none focus:border-brand" value={f.beneficios ?? ''} maxLength={200} onChange={(e) => setF({ ...f, beneficios: e.target.value })} /></Campo>
            <div className="grid gap-4 sm:grid-cols-2">
              <Campo etiqueta="Vigencia (meses)"><input className={inputCls} inputMode="numeric" value={f.vigenciaMeses ?? 12} onChange={(e) => setF({ ...f, vigenciaMeses: Math.min(60, Number(e.target.value.replace(/\D/g, '')) || 1) })} /></Campo>
              <Campo etiqueta="Estado"><label className="flex h-9 items-center gap-2 text-[13px]"><input type="checkbox" checked={f.activa ?? true} onChange={(e) => setF({ ...f, activa: e.target.checked })} />Club activo</label></Campo>
            </div>
            <div><div className="mb-1.5 text-[12px] font-semibold text-ink-2">Color</div><div className="flex flex-wrap gap-2">{COLORES.map((c) => (
              <button key={c} type="button" aria-label={`Color ${c}`} aria-pressed={f.color === c} onClick={() => setF({ ...f, color: c })} className={clsx('h-8 w-8 rounded-full ring-offset-2 ring-offset-surface transition', f.color === c && 'ring-2 ring-ink')} style={{ background: c }} />))}</div></div>
          </div>
        )}
      </Modal>
    </div>
  )
}
