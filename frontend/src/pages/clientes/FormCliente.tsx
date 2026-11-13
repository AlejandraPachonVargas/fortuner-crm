import clsx from 'clsx'
import { Check, CheckCircle2, CircleAlert, Lock, Mail, MapPin, MessageCircle, MessageSquareText, Phone, ShieldCheck, Tag, UserRound, Users, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Btn, Card, inputCls, Notice, Skeleton } from '@/components/ui'
import { Anillo, Campo, selectCls, usePermisos } from './comun'
import { useCatalogos } from './datos'
import { MEDIOS_CONSENTIMIENTO, type Cliente, type Consentimiento, type DatosCliente, type TipoDoc } from './modelo'
import { completitud, contactable, documentoValido, edadDe, errorCelular, errorEmail, errorNacimiento, errorNombre, faltantes } from './validacion'

export const VACIO: DatosCliente = {
  documento: '', tipoDoc: 'CC', nombre1: '', nombre2: '', apellido1: '', apellido2: '', sexo: 'N', nacimiento: null, profesionId: null,
  empresa: '', estadoCivil: '', hijos: null, celular: '', telefono: '', email: '', departamentoId: '17', ciudadId: '17001', barrioId: '', direccion: '',
  consentimiento: 'sin_registro', autorizaSms: null, autorizaEmail: null, autorizaWhatsapp: null, consentFecha: null, consentMedio: '', etiquetas: [], notas: '',
}
export const aDatos = (c: Cliente): DatosCliente => ({
  documento: c.documento, tipoDoc: c.tipoDoc, nombre1: c.nombre1, nombre2: c.nombre2, apellido1: c.apellido1, apellido2: c.apellido2, sexo: c.sexo,
  nacimiento: c.nacimiento, profesionId: c.profesionId, empresa: c.empresa, estadoCivil: c.estadoCivil, hijos: c.hijos, celular: c.celular,
  telefono: c.telefono, email: c.email, departamentoId: c.departamentoId, ciudadId: c.ciudadId, barrioId: c.barrioId, direccion: c.direccion,
  consentimiento: c.consentimiento, autorizaSms: c.autorizaSms, autorizaEmail: c.autorizaEmail, autorizaWhatsapp: c.autorizaWhatsapp,
  consentFecha: c.consentFecha, consentMedio: c.consentMedio, etiquetas: c.etiquetas, notas: c.notas,
})

interface Props {
  inicial: DatosCliente; modo: 'crear' | 'editar'; cliente?: Cliente
  onGuardar: (d: DatosCliente) => Promise<string | void>; onCancelar: () => void
}

const CONSENT: { id: Consentimiento; titulo: string; ayuda: string }[] = [
  { id: 'si', titulo: 'Autoriza', ayuda: 'Aceptó el tratamiento de sus datos y las comunicaciones.' },
  { id: 'no', titulo: 'No autoriza', ayuda: 'Negó el tratamiento: nunca se le contacta.' },
  { id: 'sin_registro', titulo: 'Sin registro', ayuda: 'Aún no se le ha preguntado.' },
]
const CANALES = [['autorizaWhatsapp', 'WhatsApp', MessageCircle], ['autorizaSms', 'SMS', MessageSquareText], ['autorizaEmail', 'Correo', Mail]] as const

export default function FormCliente({ inicial, modo, cliente, onGuardar, onCancelar }: Props) {
  const cat = useCatalogos().data
  const [d, setD] = useState<DatosCliente>(inicial)
  const [intento, setIntento] = useState(false)
  const [errGlobal, setErrGlobal] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)
  const [tag, setTag] = useState('')
  const { editar } = usePermisos()
  const set = (p: Partial<DatosCliente>) => setD((x) => ({ ...x, ...p }))
  const sucio = JSON.stringify(d) !== JSON.stringify(inicial)

  const ciudades = useMemo(() => cat?.ciudades.filter((c) => c.dpto === d.departamentoId) ?? [], [cat, d.departamentoId])
  const barrios = useMemo(() => cat?.barrios.filter((b) => b.ciudad === d.ciudadId && b.asignable) ?? [], [cat, d.ciudadId])
  const puntaje = completitud({ ...d, cumple: cliente?.cumple })
  const falta = faltantes({ ...d, cumple: cliente?.cumple })
  const canal = contactable(d)

  const errores = {
    documento: modo === 'crear' && !documentoValido(d.documento) ? 'Solo números, de 5 a 10 dígitos (límite del ERP).' : null,
    nombre1: errorNombre(d.nombre1, true), nombre2: errorNombre(d.nombre2, false), apellido1: errorNombre(d.apellido1, true), apellido2: errorNombre(d.apellido2, false),
    celular: errorCelular(d.celular), email: errorEmail(d.email), nacimiento: errorNacimiento(d.nacimiento),
    direccion: d.direccion.length > 60 ? 'Máximo 60 caracteres (límite del ERP).' : null,
  }
  const hayErrores = Object.values(errores).some(Boolean)
  const ver = (k: keyof typeof errores) => (intento || (k !== 'documento' && (d as unknown as Record<string, unknown>)[k]) ? errores[k] : null)

  const guardar = async () => {
    setIntento(true)
    if (hayErrores) { setErrGlobal('Revise los campos marcados en rojo.'); return }
    setGuardando(true)
    try {
      const r = await onGuardar({ ...d, email: d.email.trim().toLowerCase() })
      setErrGlobal(r ?? null)
    } finally { setGuardando(false) }
  }
  const agregarTag = () => { const t = tag.trim().replace(/\|/g, '').slice(0, 24); if (t && !d.etiquetas.includes(t)) set({ etiquetas: [...d.etiquetas, t] }); setTag('') }
  const dis = !editar || (modo === 'editar' && cliente && !cliente.editable)
  if (!cat) return <Skeleton h={420} />

  return (
    <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_300px]">
      <div className="min-w-0 space-y-5">
        {!editar && <Notice tone="info">Puedes ver la ficha pero no modificarla (tu rol o el modo de solo lectura no lo permiten).</Notice>}
        <Card icon={<UserRound size={18} />} title="Identificación" subtitle="Documento y tarjeta son las llaves del cliente en el ERP: no se cambian una vez creado">
          <div className="grid gap-4 sm:grid-cols-6">
            <div className="sm:col-span-2"><Campo etiqueta="Tipo de documento"><select className={selectCls} value={d.tipoDoc} disabled={!!dis} onChange={(e) => set({ tipoDoc: e.target.value as TipoDoc })}>
              {cat.tiposDoc.map((t) => <option key={t.id} value={t.id}>{t.id} · {t.nombre}</option>)}</select></Campo></div>
            <div className="sm:col-span-2"><Campo etiqueta="Número de documento" requerido error={ver('documento')} ayuda={modo === 'editar' ? <span className="inline-flex items-center gap-1"><Lock size={11} />Llave de las ventas (CEDCLI): no editable.</span> : 'Con él se genera la tarjeta: 2 + documento a 12 dígitos.'}>
              <input className={clsx(inputCls, errores.documento && intento && 'border-bad')} inputMode="numeric" value={d.documento} disabled={!!dis || modo === 'editar'} maxLength={10} onChange={(e) => set({ documento: e.target.value.replace(/\D/g, '') })} placeholder="Ej.: 1053800123" /></Campo></div>
            <div className="sm:col-span-2"><Campo etiqueta="Tarjeta Gana Mercaldas" ayuda={<span className="inline-flex items-center gap-1"><Lock size={11} />CODCLI: la asigna el sistema.</span>}>
              <input className={inputCls} value={cliente?.tarjeta ?? (documentoValido(d.documento) ? '2' + d.documento.padStart(12, '0') : '')} disabled readOnly /></Campo></div>
            <div className="sm:col-span-3"><Campo etiqueta="Primer nombre" requerido error={ver('nombre1')}><input className={inputCls} value={d.nombre1} disabled={!!dis} maxLength={50} onChange={(e) => set({ nombre1: e.target.value })} /></Campo></div>
            <div className="sm:col-span-3"><Campo etiqueta="Segundo nombre" error={ver('nombre2')}><input className={inputCls} value={d.nombre2} disabled={!!dis} maxLength={50} onChange={(e) => set({ nombre2: e.target.value })} /></Campo></div>
            <div className="sm:col-span-3"><Campo etiqueta="Primer apellido" requerido error={ver('apellido1')}><input className={inputCls} value={d.apellido1} disabled={!!dis} maxLength={50} onChange={(e) => set({ apellido1: e.target.value })} /></Campo></div>
            <div className="sm:col-span-3"><Campo etiqueta="Segundo apellido" error={ver('apellido2')}><input className={inputCls} value={d.apellido2} disabled={!!dis} maxLength={50} onChange={(e) => set({ apellido2: e.target.value })} /></Campo></div>
            {cliente && !cliente.nombre1 && cliente.nombreErp && <div className="sm:col-span-6"><Notice tone="info">En el ERP este cliente solo tiene el nombre completo «{cliente.nombreErp}». Sepárelo en nombres y apellidos para completar la ficha.</Notice></div>}
            <div className="sm:col-span-2"><Campo etiqueta="Género"><select className={selectCls} value={d.sexo} disabled={!!dis} onChange={(e) => set({ sexo: e.target.value as DatosCliente['sexo'] })}>
              <option value="F">Mujer</option><option value="M">Hombre</option><option value="N">No registrado</option></select></Campo></div>
            <div className="sm:col-span-2"><Campo etiqueta="Fecha de nacimiento" error={ver('nacimiento')} ayuda={edadDe(d.nacimiento) != null ? `${edadDe(d.nacimiento)} años` : cliente?.cumple ? `El ERP solo tiene el cumpleaños (${cliente.cumple.split('-').reverse().join('/')}), falta el año.` : undefined}>
              <input type="date" className={inputCls} value={d.nacimiento ?? ''} disabled={!!dis} max={new Date().toISOString().slice(0, 10)} onChange={(e) => set({ nacimiento: e.target.value || null })} /></Campo></div>
            <div className="sm:col-span-2"><Campo etiqueta="Profesión" ayuda={!d.profesionId && cliente?.profesionTexto ? `En el ERP: «${cliente.profesionTexto}»` : 'Catálogo GANPROFE'}><select className={selectCls} value={d.profesionId ?? ''} disabled={!!dis} onChange={(e) => set({ profesionId: e.target.value || null })}>
              <option value="">Sin dato</option>{cat.profesiones.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
              {d.profesionId && !cat.profesiones.some((p) => p.id === d.profesionId) && <option value={d.profesionId}>{cliente?.profesionTexto || d.profesionId} (fuera del catálogo)</option>}</select></Campo></div>
          </div>
        </Card>

        <Card icon={<Phone size={18} />} title="Contacto" subtitle="Se valida mientras escribes, con las mismas reglas del servidor">
          <div className="grid gap-4 sm:grid-cols-3">
            <Campo etiqueta="Celular" error={ver('celular')} ayuda={d.celular && !errores.celular ? <span className="inline-flex items-center gap-1 text-good"><CheckCircle2 size={12} />Celular válido</span> : 'Para WhatsApp y SMS.'}>
              <input className={inputCls} inputMode="tel" value={d.celular} disabled={!!dis} maxLength={14} onChange={(e) => set({ celular: e.target.value })} placeholder="3101234567" /></Campo>
            <Campo etiqueta="Correo electrónico" error={ver('email')} ayuda={d.email && !errores.email ? <span className="inline-flex items-center gap-1 text-good"><CheckCircle2 size={12} />Correo válido</span> : 'El canal más económico.'}>
              <input className={inputCls} type="email" value={d.email} disabled={!!dis} maxLength={50} onChange={(e) => set({ email: e.target.value })} placeholder="nombre@dominio.com" /></Campo>
            <Campo etiqueta="Teléfono fijo" ayuda="7 a 10 dígitos."><input className={inputCls} inputMode="tel" value={d.telefono} disabled={!!dis} maxLength={10} onChange={(e) => set({ telefono: e.target.value.replace(/\D/g, '') })} /></Campo>
          </div>
        </Card>

        <Card icon={<MapPin size={18} />} title="Ubicación" subtitle="Catálogos de GANAPTOS (CIUDAD, DPTOS, GANBARRIO): evitan escribir la misma ciudad de cinco formas">
          <div className="grid gap-4 sm:grid-cols-3">
            <Campo etiqueta="Departamento"><select className={selectCls} value={d.departamentoId} disabled={!!dis} onChange={(e) => set({ departamentoId: e.target.value, ciudadId: '', barrioId: '' })}>
              <option value="">Sin dato</option>{cat.departamentos.map((x) => <option key={x.id} value={x.id}>{x.nombre}</option>)}</select></Campo>
            <Campo etiqueta="Ciudad" ayuda={!d.ciudadId && cliente?.ciudadTexto ? `En el ERP: «${cliente.ciudadTexto}»` : undefined}><select className={selectCls} value={d.ciudadId} disabled={!!dis || !d.departamentoId} onChange={(e) => set({ ciudadId: e.target.value, barrioId: '' })}>
              <option value="">Sin dato</option>{ciudades.map((x) => <option key={x.id} value={x.id}>{x.nombre}</option>)}</select></Campo>
            <Campo etiqueta="Barrio" ayuda={d.ciudadId && !barrios.length ? 'No hay barrios en GANBARRIO para esta ciudad.' : !d.barrioId && cliente?.barrioTexto ? `En el ERP: «${cliente.barrioTexto}»` : undefined}>
              <select className={selectCls} value={d.barrioId} disabled={!!dis || !barrios.length} onChange={(e) => set({ barrioId: e.target.value })}>
                <option value="">Sin dato</option>{barrios.map((x) => <option key={x.id} value={x.id}>{x.nombre}{x.tipo && x.tipo !== 'Barrio' ? ` (${x.tipo.toLowerCase()})` : ''}</option>)}
                {d.barrioId && !barrios.some((b) => b.id === d.barrioId) && <option value={d.barrioId}>{cliente?.barrioTexto || d.barrioId} (fuera del catálogo)</option>}</select></Campo>
            <div className="sm:col-span-3"><Campo etiqueta="Dirección" error={ver('direccion')}><input className={inputCls} value={d.direccion} disabled={!!dis} maxLength={60} onChange={(e) => set({ direccion: e.target.value })} placeholder="Cra 23 # 45-12" /></Campo></div>
          </div>
        </Card>

        <Card icon={<Users size={18} />} title="Más datos" subtitle="Opcionales: enriquecen la segmentación">
          <div className="grid gap-4 sm:grid-cols-3">
            <Campo etiqueta="Estado civil"><select className={selectCls} value={d.estadoCivil} disabled={!!dis} onChange={(e) => set({ estadoCivil: e.target.value })}><option value="">Sin dato</option>{cat.estadosCiviles.map((x) => <option key={x}>{x}</option>)}</select></Campo>
            <Campo etiqueta="Hijos"><input className={inputCls} inputMode="numeric" value={d.hijos ?? ''} disabled={!!dis} maxLength={2} onChange={(e) => { const n = e.target.value.replace(/\D/g, ''); set({ hijos: n === '' ? null : Math.min(20, Number(n)) }) }} /></Campo>
            <Campo etiqueta="Empresa donde trabaja"><input className={inputCls} value={d.empresa} disabled={!!dis} maxLength={30} onChange={(e) => set({ empresa: e.target.value })} /></Campo>
          </div>
        </Card>

        <Card icon={<ShieldCheck size={18} />} title="Consentimiento de datos" subtitle="Ley 1581 de 2012 · sin autorización no se puede contactar al cliente">
          <div role="radiogroup" aria-label="Consentimiento" className="grid gap-2.5 sm:grid-cols-3">
            {CONSENT.map((o) => (
              <button key={o.id} type="button" role="radio" aria-checked={d.consentimiento === o.id} disabled={!!dis} onClick={() => set({ consentimiento: o.id, consentFecha: o.id === 'sin_registro' ? null : d.consentFecha ?? new Date().toISOString().slice(0, 10), ...(o.id === 'no' ? { autorizaSms: false, autorizaEmail: false, autorizaWhatsapp: false } : {}) })}
                className={clsx('rounded-2xl border p-3.5 text-left transition disabled:opacity-60', d.consentimiento === o.id ? (o.id === 'si' ? 'border-good bg-good-soft ring-2 ring-good/20' : o.id === 'no' ? 'border-bad bg-bad-soft ring-2 ring-bad/20' : 'border-brand bg-brand-soft ring-2 ring-brand/15') : 'border-line hover:bg-surface-hover')}>
                <span className="flex items-center gap-2 text-[13.5px] font-bold text-ink">{d.consentimiento === o.id && <Check size={14} strokeWidth={3} />}{o.titulo}</span>
                <span className="mt-0.5 block text-[11.5px] leading-snug text-ink-3">{o.ayuda}</span>
              </button>
            ))}
          </div>
          {d.consentimiento === 'si' && (
            <div className="mt-4">
              <div className="mb-1.5 text-[12px] font-semibold text-ink-2">Canales que autorizó</div>
              <div className="grid gap-2 sm:grid-cols-3">
                {CANALES.map(([k, l, I]) => (
                  <label key={k} className="flex items-center gap-2 rounded-xl border border-line px-3 py-2 text-[12.5px]">
                    <I size={15} className="text-ink-3" /><span className="flex-1 text-ink-2">{l}</span>
                    <select aria-label={`Autoriza ${l}`} className="h-7 rounded-md border border-line-strong bg-surface px-1.5 text-[12px]" disabled={!!dis} value={d[k] === true ? 'si' : d[k] === false ? 'no' : ''}
                      onChange={(e) => set({ [k]: e.target.value === 'si' ? true : e.target.value === 'no' ? false : null } as Partial<DatosCliente>)}>
                      <option value="">Sin dato</option><option value="si">Sí</option><option value="no">No</option></select>
                  </label>))}
              </div>
            </div>
          )}
          {d.consentimiento !== 'sin_registro' && (
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <Campo etiqueta="Fecha" ayuda="Evidencia para la Ley 1581 (tabla CRM_CLIENTE_EXT)."><input type="date" className={inputCls} value={d.consentFecha ?? ''} disabled={!!dis} onChange={(e) => set({ consentFecha: e.target.value || null })} /></Campo>
              <Campo etiqueta="¿Cómo se obtuvo?"><select className={selectCls} value={d.consentMedio} disabled={!!dis} onChange={(e) => set({ consentMedio: e.target.value })}><option value="">Sin dato</option>{MEDIOS_CONSENTIMIENTO.map((m) => <option key={m}>{m}</option>)}</select></Campo>
            </div>
          )}
        </Card>

        <Card icon={<Tag size={18} />} title="Etiquetas y observaciones" subtitle="Viven en las tablas del CRM; no tocan el ERP">
          <div className="space-y-4">
            <div>
              <div className="mb-1.5 text-[12px] font-semibold text-ink-2">Etiquetas</div>
              <div className="flex flex-wrap items-center gap-1.5">
                {d.etiquetas.map((t) => <span key={t} className="inline-flex items-center gap-1 rounded-full bg-brand-soft px-2.5 py-1 text-[12px] font-semibold text-brand">{t}{!dis && <button type="button" aria-label={`Quitar ${t}`} onClick={() => set({ etiquetas: d.etiquetas.filter((x) => x !== t) })}><X size={12} /></button>}</span>)}
                {!dis && <input value={tag} onChange={(e) => setTag(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); agregarTag() } }} onBlur={agregarTag} placeholder="Nueva etiqueta + Enter" aria-label="Nueva etiqueta" className="h-8 w-44 rounded-full border border-dashed border-line-strong bg-transparent px-3 text-[12px] outline-none focus:border-brand" />}
              </div>
            </div>
            <Campo etiqueta="Observaciones"><textarea rows={3} className="w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-[13px] outline-none focus:border-brand" value={d.notas} disabled={!!dis} maxLength={1000} onChange={(e) => set({ notas: e.target.value })} /></Campo>
            {cliente?.observacionErp && <p className="text-[12px] text-ink-3"><b>Observación en el ERP:</b> {cliente.observacionErp}</p>}
          </div>
        </Card>

        {errGlobal && <Notice tone="bad">{errGlobal}</Notice>}
        <div className="flex flex-wrap items-center gap-3 pb-6">
          <Btn variant="primary" busy={guardando} disabled={!!dis || (modo === 'editar' && !sucio)} onClick={() => void guardar()} icon={<Check size={15} />}>{modo === 'crear' ? 'Crear cliente en el ERP' : 'Guardar cambios'}</Btn>
          <Btn variant="ghost" onClick={onCancelar}>{modo === 'crear' ? 'Cancelar' : 'Descartar'}</Btn>
          {sucio && <span className="text-[12px] text-warn">Tienes cambios sin guardar.</span>}
        </div>
      </div>

      <aside className="min-w-0 space-y-5 xl:sticky xl:top-0">
        <Card title="Calidad de la ficha">
          <div className="flex items-center gap-3"><Anillo valor={puntaje} size={56} grosor={6} /><div className="text-[12.5px] text-ink-2">{puntaje >= 80 ? 'Ficha completa y utilizable.' : puntaje >= 50 ? 'Ficha aceptable, aún se puede mejorar.' : 'Ficha pobre: faltan datos clave.'}</div></div>
          {falta.length > 0 && (
            <ul className="mt-3 space-y-1.5 border-t border-line pt-3">
              {falta.slice(0, 6).map((f) => <li key={f.campo} className="flex items-center gap-2 text-[12.5px] text-ink-2"><CircleAlert size={13} className="shrink-0 text-warn" />Falta {f.etiqueta.toLowerCase()} <span className="ml-auto text-[11px] text-ink-3">+{f.peso}</span></li>)}
            </ul>
          )}
        </Card>
        <Card title="¿Por dónde se le puede escribir?" subtitle="Autorización + dato válido + canal no negado">
          <ul className="space-y-2 text-[12.5px]">
            {([['whatsapp', 'WhatsApp', MessageCircle], ['sms', 'SMS', MessageSquareText], ['email', 'Correo', Mail]] as const).map(([k, l, I]) => (
              <li key={k} className="flex items-center gap-2"><I size={15} className="text-ink-3" /><span className="text-ink-2">{l}</span><span className={clsx('ml-auto font-semibold', canal[k] ? 'text-good' : 'text-ink-3')}>{canal[k] ? 'Sí' : 'No'}</span></li>
            ))}
          </ul>
        </Card>
        <Card title="Dónde se guarda">
          <ul className="space-y-1.5 text-[12px] text-ink-3">
            <li><b className="text-ink-2">POSCLI (ERP):</b> nombres, documento, contacto, nacimiento, ubicación, profesión, autorizaciones.</li>
            <li><b className="text-ink-2">CRM_CLIENTE_EXT:</b> etiquetas, observaciones, fecha y medio del consentimiento.</li>
            <li>Cada cambio queda en <b className="text-ink-2">CRM_AUDITORIA</b> con el antes y el después.</li>
          </ul>
        </Card>
      </aside>
    </div>
  )
}
