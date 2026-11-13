import clsx from 'clsx'
import { CheckCircle2, CircleAlert, FileSpreadsheet, Upload } from 'lucide-react'
import { useRef, useState } from 'react'
import { Btn, Notice, Spinner } from '@/components/ui'
import { Modal } from './comun'
import { op, useMutar, type FilaImport } from './datos'

const PLANTILLA = 'documento,nombres,apellidos,celular,email,ciudad\n1053800123,María José,Gómez Ríos,3101234567,maria@correo.com,Manizales\n'

/** CSV simple con comillas. Separador coma o punto y coma. */
export function parsear(t: string): Record<string, string>[] {
  const lineas = t.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim())
  if (lineas.length < 2) return []
  const sep = lineas[0].includes(';') && !lineas[0].includes(',') ? ';' : ','
  const celdas = (l: string) => { const o: string[] = []; let cur = '', q = false; for (const ch of l) { if (ch === '"') q = !q; else if (ch === sep && !q) { o.push(cur); cur = '' } else cur += ch } o.push(cur); return o.map((x) => x.trim()) }
  const cab = celdas(lineas[0]).map((h) => h.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase())
  return lineas.slice(1, 5001).map((l) => Object.fromEntries(celdas(l).map((v, i) => [cab[i] ?? `c${i}`, v])))
}

export default function ImportarDialog({ abierto, onCerrar, onHecho }: { abierto: boolean; onCerrar: () => void; onHecho: (m: string) => void }) {
  const [crudas, setCrudas] = useState<Record<string, string>[] | null>(null)
  const [filas, setFilas] = useState<FilaImport[] | null>(null)
  const [nombre, setNombre] = useState('')
  const [err, setErr] = useState('')
  const [validando, setValidando] = useState(false)
  const ref = useRef<HTMLInputElement>(null)
  const aplicar = useMutar(op.aplicarImport)
  const validas = filas?.filter((f) => f.errores.length === 0).length ?? 0
  const cerrar = () => { setFilas(null); setCrudas(null); setNombre(''); setErr(''); onCerrar() }

  const leer = async (f: File | undefined) => {
    if (!f) return
    if (f.size > 5_000_000) { setErr('El archivo supera 5 MB.'); return }
    if (!/\.(csv|txt)$/i.test(f.name)) { setErr('Usa un archivo .csv (en Excel: Guardar como → CSV).'); return }
    const rows = parsear(await f.text())
    if (!rows.length) { setErr('No se encontraron filas. Revisa que tenga encabezados y datos.'); return }
    setErr(''); setNombre(f.name); setValidando(true)
    try { setFilas(await op.validarImport(rows)); setCrudas(rows) } catch (e) { setErr(e instanceof Error ? e.message : 'No se pudo validar') } finally { setValidando(false) }
  }
  const importar = async () => {
    if (!crudas) return
    try {
      const r = await aplicar.mutateAsync(crudas)
      onHecho(`Importación lista: ${r.creados} creado(s) en el ERP, ${r.actualizados} completado(s), ${(filas?.length ?? 0) - validas} omitido(s) por errores.${r.errores.length ? ` Avisos: ${r.errores.slice(0, 3).join(' · ')}` : ''}`)
      cerrar()
    } catch (e) { setErr(e instanceof Error ? e.message : 'No se pudo importar') }
  }
  const descargarPlantilla = () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + PLANTILLA], { type: 'text/csv;charset=utf-8' })); a.download = 'plantilla-clientes.csv'; a.click(); URL.revokeObjectURL(a.href) }

  return (
    <Modal abierto={abierto} titulo="Importar clientes" subtitulo="Crea los nuevos en el ERP y completa (sin pisar) los datos vacíos de los existentes" onCerrar={cerrar} ancho="max-w-3xl"
      pie={<><Btn onClick={cerrar}>Cancelar</Btn><Btn variant="primary" busy={aplicar.isPending} disabled={!validas} onClick={() => void importar()}>Importar {validas ? `${validas} fila(s)` : ''}</Btn></>}>
      <div className="space-y-4">
        {!filas ? (
          <>
            <button type="button" onClick={() => ref.current?.click()} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); void leer(e.dataTransfer.files[0]) }}
              className="flex w-full flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-line-strong px-6 py-10 text-center transition hover:border-brand hover:bg-brand-soft/40">
              {validando ? <Spinner size={26} /> : <Upload size={26} className="text-brand" />}<span className="text-[14px] font-bold text-ink">{validando ? 'Validando contra el ERP…' : 'Arrastra un archivo CSV o haz clic para elegirlo'}</span><span className="text-[12px] text-ink-3">Columnas: documento, nombres, apellidos, celular, email, ciudad · hasta 5.000 filas</span>
            </button>
            <input ref={ref} type="file" accept=".csv,.txt" className="sr-only" aria-label="Archivo CSV" onChange={(e) => void leer(e.target.files?.[0])} />
            <Btn small variant="ghost" icon={<FileSpreadsheet size={14} />} onClick={descargarPlantilla}>Descargar plantilla</Btn>
            <Notice tone="info">Primero el servidor revisa todo contra el ERP: nada se escribe hasta que confirmes. El documento nunca se modifica y los datos que ya existen no se sobrescriben. Cada alta y cada dato completado quedan en la auditoría.</Notice>
          </>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-3 text-[13px]"><b className="text-ink">{nombre}</b>
              <span className="flex items-center gap-1 text-good"><CheckCircle2 size={14} />{validas} válidas</span>
              <span className={clsx('flex items-center gap-1', filas.length - validas ? 'text-bad' : 'text-ink-3')}><CircleAlert size={14} />{filas.length - validas} con errores</span>
              <button type="button" onClick={() => { setFilas(null); setCrudas(null) }} className="ml-auto text-[12.5px] font-semibold text-brand underline">Elegir otro archivo</button></div>
            <div className="max-h-72 overflow-auto rounded-xl border border-line scroll-thin">
              <table className="w-full min-w-[620px] text-left text-[12px]">
                <thead className="sticky top-0 bg-surface-2 text-ink-3"><tr><th className="px-3 py-2">Fila</th><th className="px-2 py-2">Documento</th><th className="px-2 py-2">Nombre</th><th className="px-2 py-2">Celular</th><th className="px-2 py-2">Acción</th><th className="px-2 py-2">Estado</th></tr></thead>
                <tbody className="divide-y divide-line">{filas.slice(0, 100).map((f) => (
                  <tr key={f.fila}><td className="px-3 py-1.5 text-ink-3">{f.fila}</td><td className="px-2 py-1.5">{f.id}</td><td className="px-2 py-1.5">{f.nombres} {f.apellidos}</td><td className="px-2 py-1.5">{f.celular}</td>
                    <td className="px-2 py-1.5 text-ink-3">{f.existe ? 'Completar' : 'Crear'}</td>
                    <td className="px-2 py-1.5">{f.errores.length ? <span className="text-bad">{f.errores.join(' · ')}</span> : <span className="text-good">Lista</span>}</td></tr>))}</tbody>
              </table>
            </div>
            {filas.length > 100 && <p className="text-[11.5px] text-ink-3">Mostrando las primeras 100 de {filas.length} filas.</p>}
          </>
        )}
        {err && <Notice tone="bad">{err}</Notice>}
      </div>
    </Modal>
  )
}
