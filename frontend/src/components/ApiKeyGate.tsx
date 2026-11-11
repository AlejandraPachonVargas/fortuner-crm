import { KeyRound } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { api, ApiError, setKey } from '@/lib/api'
import { Btn, inputCls } from './ui'

/** Si el servidor exige clave de acceso (producción) la pide una vez por pestaña. En desarrollo no estorba. */
export default function ApiKeyGate({ children }: { children: ReactNode }) {
  const [ok, setOk] = useState<boolean | null>(null)
  const [key, setK] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const probar = async (k?: string) => {
    if (k !== undefined) setKey(k)
    setBusy(true); setErr('')
    try { await api('/sistema/estado'); setOk(true) }
    catch (e) {
      if (e instanceof ApiError && e.status === 401) { setOk(false); if (k) setErr('La clave no es válida.') }
      else setOk(true) // otro error (p. ej. sin datos cargados): la clave no es el problema
    } finally { setBusy(false) }
  }
  useEffect(() => { void probar() }, [])

  if (ok === null) return <div className="grid h-full place-items-center text-ink-3">Conectando…</div>
  if (ok) return <>{children}</>
  return (
    <div className="grid h-full place-items-center bg-page p-4">
      <form className="card w-full max-w-sm p-6" onSubmit={(e) => { e.preventDefault(); void probar(key.trim()) }}>
        <div className="mb-4 flex items-center gap-2 text-[16px] font-bold text-ink"><KeyRound size={18} /> Acceso al CRM</div>
        <label className="text-[12px] font-semibold text-ink-2" htmlFor="clave">Clave de acceso</label>
        <input id="clave" type="password" autoFocus autoComplete="off" value={key} onChange={(e) => setK(e.target.value)} className={`${inputCls} mt-1`} />
        {err && <p role="alert" className="mt-2 text-[12.5px] text-bad">{err}</p>}
        <Btn variant="primary" busy={busy} type="submit" className="mt-4 w-full" disabled={!key.trim()}>Entrar</Btn>
        <p className="mt-3 text-[11.5px] text-ink-3">Solicítela al administrador del sistema.</p>
      </form>
    </div>
  )
}
