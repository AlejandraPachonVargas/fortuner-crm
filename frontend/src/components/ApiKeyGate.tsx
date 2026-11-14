import { AlertCircle, KeyRound, LoaderCircle } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { api, ApiError, setKey } from '@/lib/api'

const LOGO_OSCURO = '/fortuner-logo-oscuro.png'
const ISOTIPO = '/fortuner-isotipo.png'

/** Si el servidor exige clave de acceso (producción) la pide una vez por pestaña. En desarrollo no estorba.
 *  Aspecto: pantalla de ingreso de Fortuner 27 (GUIA_REDISENO_MODULOS.md §9); el campo y su lógica no cambian. */
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

  if (ok === null) return (
    <div className="grid h-full place-items-center bg-[#F7F7F7]">
      <div className="flex flex-col items-center gap-5">
        <img src={ISOTIPO} alt="" width={743} height={851} className="h-14 w-auto animate-pulse" />
        <div className="flex items-center gap-3 text-sm font-medium text-[#5B6B7A]"><LoaderCircle className="animate-spin text-[#0F70FC]" size={20} />Conectando…</div>
      </div>
    </div>
  )
  if (ok) return <>{children}</>
  return (
    <div className="grid min-h-full overflow-y-auto bg-[#F7F7F7] text-[#002D49] md:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
      <aside className="relative hidden flex-col justify-between overflow-hidden px-14 py-12 text-white md:flex" style={{ background: 'var(--fx-masthead)' }} aria-hidden="true">
        <img src={ISOTIPO} alt="" className="pointer-events-none absolute -right-28 -bottom-20 w-[560px] opacity-[.09] select-none" />
        <img src={LOGO_OSCURO} alt="" width={1400} height={264} className="relative mt-[8vh] block h-auto w-[min(540px,92%)]" />
        <div className="relative max-w-[460px]">
          <div className="mb-7 flex gap-1.5"><i className="block h-1 w-9 rounded bg-[#21CC93]" /><i className="block h-1 w-5 rounded bg-[#1FCEC4]" /><i className="block h-1 w-3 rounded bg-[#33B1FF]" /><i className="block h-1 w-2 rounded bg-[#0F70FC]" /></div>
          <h2 className="mb-4 text-[clamp(26px,2.6vw,36px)] leading-tight font-semibold tracking-tight">
            CRM de <span className="bg-gradient-to-r from-[#21CC93] via-[#1FCEC4] to-[#33B1FF] bg-clip-text text-transparent">Fortuner</span>
          </h2>
          <p className="text-[15px] leading-7 text-white/70">Campañas segmentadas y Clientes 360° sobre los datos del ERP.</p>
        </div>
        <div className="relative text-xs tracking-wide text-white/50">Fortuner 27.0 · Software Empresarial · © 2026 DSI S.A.</div>
      </aside>

      <main className="relative flex items-start justify-center px-4 pb-16 md:items-center md:px-6 md:py-12">
        <div className="absolute inset-x-0 top-0 h-60 md:hidden" style={{ background: 'var(--fx-masthead)' }} aria-hidden="true" />
        <img src={LOGO_OSCURO} alt="Fortuner Software Empresarial" width={1400} height={264} className="absolute top-11 left-1/2 w-[min(320px,82vw)] -translate-x-1/2 md:hidden" />
        <section className="relative mt-36 w-full max-w-[420px] overflow-hidden rounded-[20px] border border-[#DFE2E5] bg-white shadow-[0_24px_60px_-24px_rgba(0,45,73,.25)] md:mt-0">
          <header className="px-6 pt-7 pb-1 md:px-9 md:pt-9 md:pb-2">
            <span className="inline-flex items-center gap-2 rounded-full bg-[#0F70FC]/8 px-3 py-1.5 text-xs font-semibold tracking-[.08em] text-[#0F70FC] uppercase"><span className="h-1.5 w-1.5 rounded-full bg-[#21CC93]" />CRM</span>
            <h1 className="mt-4 mb-1.5 text-[26px] font-bold tracking-tight">Acceso al CRM</h1>
          </header>
          <form className="grid gap-[18px] px-6 pt-5 pb-7 md:px-9 md:pt-6 md:pb-8" onSubmit={(e) => { e.preventDefault(); void probar(key.trim()) }}>
            <div>
              <label className="mb-2 block text-[13px] font-semibold" htmlFor="clave">Clave de acceso</label>
              <div className="group relative">
                <KeyRound className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-[#8A97A3] transition-colors group-focus-within:text-[#0F70FC]" size={18} />
                <input id="clave" type="password" autoFocus autoComplete="off" value={key} onChange={(e) => setK(e.target.value)}
                  className="w-full rounded-xl border-[1.5px] border-[#DFE2E5] bg-[#F7F7F7] py-3 pr-3 pl-11 text-[14px] text-[#002D49] outline-none transition focus:border-[#0F70FC] focus:bg-white focus:ring-4 focus:ring-[rgba(15,112,252,.12)]" />
              </div>
            </div>
            {err && <div role="alert" className="flex items-start gap-2.5 rounded-xl border border-[#F5C2C2] bg-[#FDECEC] px-3.5 py-3 text-[13px] leading-5 text-[#B42318]"><AlertCircle className="mt-px shrink-0" size={18} />{err}</div>}
            <button type="submit" disabled={!key.trim() || busy}
              className="fx-primario flex w-full items-center justify-center gap-2.5 rounded-xl px-4 py-3.5 text-[15px] font-semibold transition active:translate-y-px disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none">
              {busy && <LoaderCircle className="animate-spin" size={18} />}Entrar
            </button>
            <p className="text-[12px] text-[#5B6B7A]">Solicítela al administrador del sistema.</p>
          </form>
          <footer className="flex items-center justify-between border-t border-[#DFE2E5] bg-[#F7F7F7] px-6 py-3.5 text-[11.5px] text-[#8A97A3] md:px-9">
            <span>Fortuner Software Empresarial</span><span className="font-semibold text-[#5B6B7A]">CRM</span>
          </footer>
        </section>
      </main>
    </div>
  )
}
