'use client'

import { useRef, useState } from 'react'
import Link from 'next/link'
import { toastError, toastSuccess, toastLoading } from '@/app/contexts/ToastContext'
import { ArrowLeft, ArrowRight, Check, CheckCircle2, AlertTriangle, Download, FileSpreadsheet, Save, Undo2 } from 'lucide-react'
import { ConfirmDialog } from '@/components/portal/Dialog'
import { formatearImporte, fusionarTotales } from '@/lib/importador/util'
import {
  obtenerCamposEntidad, crearLoteImport, validarLoteImport, aplicarLoteImport,
  deshacerLoteImport, listarPlantillasImport, guardarPlantillaImport, cargarPlantillaImport,
  plantillaImport,
} from '@/app/actions/portal/importar'

// MIME del .xlsx. Se escribe aquí y no se importa de `@/lib/exportar/excel` a
// propósito: ese módulo arrastra el escritor de Excel (server-only) y no debe
// entrar en el bundle del cliente.
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

type Campo    = { campo: string; etiqueta: string; obligatorio: boolean; ayuda?: string; alias?: string[]; ejemplo?: string }
type Default  = { campo: string; etiqueta: string; obligatorio: boolean; ayuda?: string; valor?: string; tipo?: 'texto' | 'fecha'; opciones?: { valor: string; etiqueta: string }[] }
type Paso     = 'entidad' | 'subir' | 'mapear' | 'validar' | 'hecho'
type Politica = 'SALTAR' | 'ACTUALIZAR' | 'CREAR'
type FilaMala = { fila: number; ok: boolean; motivo?: string }
type Total    = { etiqueta: string; valor: number }

// Maestros primero, estado financiero después: el orden de la lista es el orden
// en que conviene importar (lo de abajo se apoya en lo de arriba).
const ENTIDADES = [
  { id: 'terceros',        etiqueta: 'Clientes y proveedores', desc: 'Terceros con contacto y datos de pago.',      disponible: true, destino: '/portal/terceros' },
  { id: 'productos',       etiqueta: 'Productos',              desc: 'Catálogo físico: precios, costos y unidad.',   disponible: true, destino: '/portal/productos' },
  { id: 'servicios',       etiqueta: 'Servicios',              desc: 'Catálogo de servicios y suscribibles.',        disponible: true, destino: '/portal/servicios' },
  { id: 'personal',        etiqueta: 'Personal',               desc: 'Trabajadores: identidad, puesto y contacto.',  disponible: true, destino: '/portal/rrhh' },
  { id: 'stock_inicial',   etiqueta: 'Stock inicial',          desc: 'Existencias a la fecha de corte. Requiere el catálogo y los almacenes ya creados.', disponible: true, destino: '/portal/inventario' },
  { id: 'tesoreria_saldo', etiqueta: 'Saldos de caja',         desc: 'Lo que hay en cada cuenta a la fecha de corte.', disponible: true, destino: '/portal/tesoreria' },
  { id: 'gastos',          etiqueta: 'Gastos',                 desc: 'Histórico de gastos por categoría. Lo pendiente va a CxP.', disponible: true, destino: '/portal/gastos' },
  { id: 'cobros',          etiqueta: 'Cobros',                 desc: 'Histórico de ingresos no facturados. Lo pendiente va a CxC.', disponible: true, destino: '/portal/gastos' },
]

const PASOS: { id: Paso; label: string }[] = [
  { id: 'entidad', label: 'Qué importar' },
  { id: 'subir',   label: 'Subir archivo' },
  { id: 'mapear',  label: 'Mapear' },
  { id: 'validar', label: 'Revisar' },
  { id: 'hecho',   label: 'Listo' },
]

/**
 * Para comparar cabeceras con nombres de campo. Se come el asterisco final
 * porque nuestra plantilla marca así lo obligatorio: el cliente nos devuelve
 * «Nombre *» y tiene que seguir emparejando con el campo «Nombre».
 */
function normaliza(s: string): string {
  return (s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\s*\*+\s*$/, '').trim()
}

/** Celda de CSV: entrecomilla solo si hace falta (comas, comillas o saltos). */
function celdaCsv(v: string): string {
  return /[",;\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v
}

function descargarCsv(nombre: string, contenido: string) {
  const blob = new Blob(['﻿' + contenido], { type: 'text/csv;charset=utf-8' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href = url; a.download = nombre; a.click()
  URL.revokeObjectURL(url)
}

/** Descarga un binario recibido en base64 (el Excel viene así de la server action). */
function descargarBase64(nombre: string, base64: string, mime: string) {
  const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0))
  const blob  = new Blob([bytes], { type: mime })
  const url   = URL.createObjectURL(blob)
  const a     = document.createElement('a')
  a.href = url; a.download = nombre; a.click()
  URL.revokeObjectURL(url)
}

/** Excel viaja en base64 por la server action (es binario, no texto). */
function aBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return btoa(s)
}

export default function ImportarWizard() {
  const [paso, setPaso]         = useState<Paso>('entidad')
  const [cargando, setCargando] = useState(false)
  const [progreso, setProgreso] = useState<{ hechas: number; total: number } | null>(null)

  const [entidad, setEntidad]     = useState('')
  const [etiquetaEnt, setEtiqueta] = useState('')
  const [destino, setDestino]     = useState('')
  const [campos, setCampos]       = useState<Campo[]>([])
  const [defs, setDefs]           = useState<Default[]>([])

  const [encoding, setEncoding]   = useState('UTF-8')
  const [loteId, setLoteId]       = useState('')
  const [cabeceras, setCabeceras] = useState<string[]>([])
  const [total, setTotal]         = useState(0)
  const [avisos, setAvisos]       = useState<string[]>([])
  const [arrastrando, setArrastrando] = useState(false)
  const [bajandoPlantilla, setBajandoPlantilla] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const [columnas, setColumnas]   = useState<Record<string, string>>({})
  const [globales, setGlobales]   = useState<Record<string, string>>({})
  const [politica, setPolitica]   = useState<Politica>('SALTAR')

  const [resultado, setResultado] = useState<{ total: number; ok: number; errores: number; filas: FilaMala[]; resumen: Total[] } | null>(null)
  const [resumen, setResumen]     = useState<{ insertadas: number; actualizadas: number; saltadas: number; errores: number } | null>(null)

  const [plantillas, setPlantillas] = useState<{ plantilla_id: string; nombre: string }[]>([])
  const [nombrePlantilla, setNombrePlantilla] = useState('')
  const [confirmarDeshacer, setConfirmarDeshacer] = useState(false)
  const [deshecho, setDeshecho]   = useState<{ deshechas: number; intactas: number; motivos: { fila: number; motivo: string }[] } | null>(null)

  const idxPaso = PASOS.findIndex(p => p.id === paso)

  /**
   * Volver a un paso ya recorrido. Solo hacia atrás y solo si ese paso todavía
   * se sostiene: sin archivo no hay nada que mapear, y una vez APLICADO el lote
   * no se vuelve — «Revisar» ofrecería importar algo que ya está importado.
   */
  function puedeVolver(destino: Paso, i: number): boolean {
    if (i >= idxPaso || paso === 'hecho') return false
    return destino === 'entidad' ? true
      : destino === 'subir'      ? !!entidad
      : destino === 'mapear'     ? !!loteId
      : !!resultado
  }

  async function elegirEntidad(en: typeof ENTIDADES[number]) {
    setCargando(true)
    const ld = toastLoading('Cargando…')
    const res = await obtenerCamposEntidad(en.id)
    await ld.dismiss()
    setCargando(false)
    if (!res.ok || !res.campos) { toastError(res.error ?? 'Error inesperado.'); return }
    // El archivo pertenece a la entidad con la que se subió: al elegir entidad se
    // suelta, o se acabaría mapeando las columnas de un archivo a los campos de otra.
    setLoteId(''); setCabeceras([]); setTotal(0); setColumnas({}); setAvisos([]); setResultado(null)
    setEntidad(en.id); setEtiqueta(res.etiqueta ?? en.etiqueta); setDestino(en.destino); setCampos(res.campos as Campo[])
    // Los valores globales (empresa, moneda, unidad…) los declara cada entidad.
    // Si solo hay una opción posible, se elige sola.
    const ds = (res.defaults ?? []) as Default[]
    setDefs(ds)
    setGlobales(Object.fromEntries(ds.map(d => [
      d.campo, d.valor ?? (d.opciones?.length === 1 ? d.opciones[0].valor : ''),
    ])))
    setPlantillas(await listarPlantillasImport(en.id))
    setPaso('subir')
  }

  async function usarPlantilla(id: string) {
    if (!id) return
    const ld = toastLoading('Cargando…')
    const res = await cargarPlantillaImport(id)
    await ld.dismiss()
    if (!res.ok || !res.columnas) { toastError(res.error ?? 'No se pudo cargar la plantilla.'); return }
    // Solo se recupera el MAPEO de columnas; los valores globales (empresa,
    // moneda…) se eligen cada vez: son de este cliente, no del origen del archivo.
    setColumnas(Object.fromEntries(campos.map(c => [c.campo, res.columnas?.[c.campo] ?? ''])))
    setPolitica((res.politica as Politica) ?? 'SALTAR')
  }

  async function guardarPlantilla() {
    const ld = toastLoading('Guardando…')
    const res = await guardarPlantillaImport(nombrePlantilla, entidad, columnas, politica)
    await ld.dismiss()
    if (!res.ok) { toastError(res.error ?? 'No se pudo guardar.'); return }
    toastSuccess(`Plantilla «${nombrePlantilla.trim()}» guardada.`)
    setPlantillas(await listarPlantillasImport(entidad))
    setNombrePlantilla('')
  }

  async function deshacer() {
    setConfirmarDeshacer(false)
    setCargando(true)
    const ld = toastLoading('Deshaciendo…')
    const res = await deshacerLoteImport(loteId)
    await ld.dismiss()
    setCargando(false)
    if (!res.ok || !res.resumen) { toastError(res.error ?? 'No se pudo deshacer.'); return }
    setDeshecho(res.resumen)
    if (res.resumen.intactas === 0) toastSuccess('Importación deshecha.')
  }

  /**
   * Plantilla modelo en EXCEL (recomendada): se genera en servidor con la marca
   * CLAUX, cabeceras con estilo y una hoja de instrucciones. Evita el problema del
   * CSV en Excel español (columnas pegadas, acentos rotos).
   */
  async function descargarPlantillaExcel() {
    if (bajandoPlantilla) return
    setBajandoPlantilla(true)
    const ld = toastLoading('Generando…')
    const res = await plantillaImport(entidad)
    await ld.dismiss()
    setBajandoPlantilla(false)
    if (!res.ok || !res.base64) { toastError(res.error ?? 'No se pudo generar la plantilla.'); return }
    descargarBase64(res.nombre ?? `plantilla-${entidad}.xlsx`, res.base64, XLSX_MIME)
  }

  /**
   * Alternativa en CSV para quien use Google Sheets u otra herramienta. Las
   * cabeceras marcan lo obligatorio con «*» (`normaliza()` lo ignora al volver) y
   * lleva la fila de ejemplo que el motor sabe rechazar.
   */
  function descargarPlantillaCsv() {
    const filas = [campos.map(c => celdaCsv(c.etiqueta + (c.obligatorio ? ' *' : ''))).join(',')]
    if (campos.some(c => c.ejemplo)) filas.push(campos.map(c => celdaCsv(c.ejemplo ?? '')).join(','))
    descargarCsv(`plantilla-${entidad}.csv`, filas.join('\n') + '\n')
  }

  async function procesarArchivo(file: File) {
    if (/\.xls$/i.test(file.name)) {
      toastError('El .xls antiguo no se puede leer. Ábrelo en Excel y guárdalo como .xlsx o CSV.')
      return
    }
    const esExcel = /\.xlsx$/i.test(file.name)
    const reader  = new FileReader()
    reader.onerror = () => { setCargando(false); toastError('No se pudo leer el archivo.') }
    reader.onload  = async () => {
      const contenido = esExcel
        ? aBase64(reader.result as ArrayBuffer)
        : (reader.result as string) ?? ''
      const ld = toastLoading('Leyendo…')
      const res = await crearLoteImport(entidad, contenido, esExcel ? 'xlsx' : 'csv')
      await ld.dismiss()
      setCargando(false)
      if (!res.ok) { toastError(res.error ?? 'No se pudo leer el archivo.'); return }
      setLoteId(res.lote_id!); setCabeceras(res.cabeceras ?? []); setTotal(res.total ?? 0)
      setAvisos(res.avisos ?? []); setResultado(null)   // lo revisado era del archivo anterior
      // Auto-mapeo por nombre de campo, etiqueta o alias (normalizando acentos)
      const cabs = (res.cabeceras ?? []).map(c => ({ raw: c, n: normaliza(c) }))
      const cols: Record<string, string> = {}
      for (const campo of campos) {
        const cand = [campo.campo, campo.etiqueta, ...(campo.alias ?? [])].map(normaliza)
        cols[campo.campo] = cabs.find(nc => cand.includes(nc.n))?.raw ?? ''
      }
      setColumnas(cols)
      setPaso('mapear')
    }
    setCargando(true)
    if (esExcel) reader.readAsArrayBuffer(file)
    else         reader.readAsText(file, encoding)
  }

  function onElegir(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (file) procesarArchivo(file)
  }

  function onSoltar(e: React.DragEvent) {
    e.preventDefault()
    setArrastrando(false)
    const file = e.dataTransfer.files?.[0]
    if (file) procesarArchivo(file)
  }

  async function validar() {
    const falta = defs.find(d => d.obligatorio && !(globales[d.campo] ?? '').trim())
    if (falta) { toastError(`Indica ${falta.etiqueta.toLowerCase()}.`); return }
    const mapeo = {
      columnas,
      defaults: Object.fromEntries(Object.entries(globales).filter(([, v]) => v.trim() !== '')),
      politica,
    }
    setCargando(true)
    const ld = toastLoading('Validando…')
    // El archivo se valida en tandas (una consulta por fila): se llama en bucle
    // hasta que el servidor dice que no queda nada, enseñando el avance.
    const acc = { total, ok: 0, errores: 0, filas: [] as FilaMala[], resumen: [] as Total[] }
    let desde: number | null = 0
    let claves: string[] = []
    while (desde !== null) {
      const res = await validarLoteImport(loteId, mapeo, desde, claves)
      if (!res.ok || !res.trozo) { await ld.dismiss(); setCargando(false); setProgreso(null); toastError(res.error ?? 'Error al validar.'); return }
      const t = res.trozo
      acc.total = t.total; acc.ok += t.ok; acc.errores += t.errores
      acc.filas.push(...t.filas.filter(f => !f.ok))   // las buenas no se pintan: solo cuentan
      acc.resumen = fusionarTotales(acc.resumen, t.resumen ?? [])
      claves = t.claves
      desde  = t.siguiente
      setProgreso(desde === null ? null : { hechas: desde, total: t.total })
    }
    await ld.dismiss()
    setCargando(false)
    setResultado(acc); setPaso('validar')
  }

  async function aplicar() {
    setCargando(true)
    const ld = toastLoading('Importando…')
    const acc = { insertadas: 0, actualizadas: 0, saltadas: 0, errores: 0 }
    let desde: number | null = 0
    let claves: string[] = []
    while (desde !== null) {
      const res = await aplicarLoteImport(loteId, desde, claves)
      if (!res.ok || !res.trozo) { await ld.dismiss(); setCargando(false); setProgreso(null); toastError(res.error ?? 'Error al importar.'); return }
      const t = res.trozo
      acc.insertadas += t.insertadas; acc.actualizadas += t.actualizadas
      acc.saltadas   += t.saltadas;   acc.errores      += t.errores
      claves = t.claves
      desde  = t.siguiente
      setProgreso(desde === null ? null : { hechas: desde, total: resultado?.total ?? total })
    }
    await ld.dismiss()
    setCargando(false)
    setResumen(acc); setPaso('hecho')
  }

  function descargarErrores() {
    if (!resultado) return
    descargarCsv(`errores-${loteId}.csv`,
      'fila,motivo\n' + resultado.filas.map(e => `${e.fila},${celdaCsv(e.motivo ?? '')}`).join('\n') + '\n')
  }

  function reiniciar() {
    setPaso('entidad'); setEntidad(''); setCampos([]); setDefs([]); setLoteId(''); setCabeceras([]); setTotal(0)
    setColumnas({}); setGlobales({}); setResultado(null); setResumen(null); setPolitica('SALTAR')
    setPlantillas([]); setNombrePlantilla(''); setDeshecho(null); setAvisos([]); setProgreso(null)
  }

  const etiquetaProgreso = progreso ? `${progreso.hechas} de ${progreso.total}` : ''

  return (
    <div className="view-container">
      <div className="page-header">
        <div>
          <h1 className="page-title">Importar datos</h1>
          <p className="page-subtitle">Carga masiva desde CSV o Excel. Herramienta de configuración (llave en mano).</p>
        </div>
      </div>

      <div className="imprt-steps">
        {PASOS.map((p, i) => {
          const volver = puedeVolver(p.id, i)
          return (
            <button key={p.id} type="button" disabled={!volver}
              onClick={() => setPaso(p.id)}
              aria-current={p.id === paso ? 'step' : undefined}
              title={volver ? `Volver a ${p.label.toLowerCase()}` : undefined}
              className={`imprt-step ${p.id === paso ? 'imprt-step-activo' : i < idxPaso ? 'imprt-step-hecho' : ''} ${volver ? 'imprt-step-atras' : ''}`}>
              <span className="imprt-step-num">{i < idxPaso ? <Check size={13} strokeWidth={3} /> : i + 1}</span>
              {p.label}
            </button>
          )
        })}
      </div>

      {/* ── Paso 1: entidad ── */}
      {paso === 'entidad' && (
        <div className="card">
          <p className="modal-body-text">¿Qué vas a importar?</p>
          <div className="imprt-entidad-grid">
            {ENTIDADES.map(en => (
              <button key={en.id} type="button" className="imprt-entidad"
                disabled={!en.disponible || cargando} onClick={() => elegirEntidad(en)}>
                <strong>{en.etiqueta}</strong>
                <span>{en.disponible ? en.desc : 'Próximamente'}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Paso 2: subir ── */}
      {paso === 'subir' && (
        <div className="card">
          <div className="alert alert-info">
            Descarga la plantilla, rellénala y súbela — o sube el archivo del cliente y mapeas las columnas en el siguiente paso.
            En Excel (.xlsx) los acentos y los decimales llegan siempre bien; en CSV dependen de la codificación.
          </div>
          <div className="ter-form-grid">
            <div className="input-group ter-col-span-3">
              <label>Plantilla modelo</label>
              <div className="imprt-plantilla-botones">
                <button type="button" className="btn btn-secondary" onClick={descargarPlantillaExcel} disabled={bajandoPlantilla}>
                  <Download size={15} strokeWidth={2} /> {bajandoPlantilla ? 'Generando…' : 'Descargar plantilla Excel'}
                </button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={descargarPlantillaCsv} disabled={bajandoPlantilla}>
                  o en CSV
                </button>
              </div>
              <span className="input-hint">Excel (recomendado): columnas y acentos siempre correctos, con instrucciones. Las columnas con <span className="required">*</span> son obligatorias; la fila de ejemplo se puede dejar, no se importa.</span>
            </div>
            <div className="input-group ter-col-span-3">
              <label htmlFor="imprt-enc">Codificación (solo CSV)</label>
              <select id="imprt-enc" className="input" value={encoding} onChange={e => setEncoding(e.target.value)}>
                <option value="UTF-8">UTF-8 (recomendado)</option>
                <option value="windows-1252">Windows-1252 (Excel en español)</option>
              </select>
            </div>
          </div>
          <input ref={fileRef} type="file" accept=".csv,.xlsx,text/csv" className="imprt-drop-input"
            onChange={onElegir} disabled={cargando} aria-label="Elegir archivo" />
          <button type="button" className={`imprt-drop ${arrastrando ? 'imprt-drop-activa' : ''}`}
            onClick={() => fileRef.current?.click()} disabled={cargando}
            onDragOver={e => { e.preventDefault(); setArrastrando(true) }}
            onDragLeave={() => setArrastrando(false)}
            onDrop={onSoltar}>
            <FileSpreadsheet size={32} strokeWidth={1.5} />
            {cargando
              ? <strong>Leyendo el archivo…</strong>
              : <>
                  <strong>Elige un archivo o arrástralo aquí</strong>
                  <span>CSV o Excel (.xlsx) de {etiquetaEnt.toLowerCase()}. Las columnas se detectan solas.</span>
                </>}
          </button>
          <div className="imprt-acciones">
            <button type="button" className="btn btn-ghost" onClick={() => setPaso('entidad')}>
              <ArrowLeft size={15} strokeWidth={2} /> Atrás
            </button>
          </div>
        </div>
      )}

      {/* ── Paso 3: mapear ── */}
      {paso === 'mapear' && (
        <div className="card">
          <p className="modal-body-text">Se detectaron <strong>{total}</strong> filas. Empareja cada campo con una columna del archivo.</p>

          {/* Lo que el archivo trae mal sin llegar a impedir el trabajo. */}
          {avisos.map(a => (
            <div key={a} className="alert alert-warning">
              <AlertTriangle size={16} strokeWidth={2} /> {a}
            </div>
          ))}

          <div className="ter-form-grid">
            {defs.map(d => (
              <div key={d.campo} className="input-group ter-col-span-2">
                <label htmlFor={`imprt-def-${d.campo}`}>
                  {d.etiqueta}{d.obligatorio && <span className="required"> *</span>}
                </label>
                {d.opciones && d.opciones.length === 1 ? (
                  <input id={`imprt-def-${d.campo}`} className="input input-static" readOnly value={d.opciones[0].etiqueta} />
                ) : d.opciones ? (
                  <select id={`imprt-def-${d.campo}`} className="input" value={globales[d.campo] ?? ''}
                    onChange={e => setGlobales({ ...globales, [d.campo]: e.target.value })}>
                    <option value="">{d.obligatorio ? 'Selecciona…' : '— Ninguna —'}</option>
                    {d.opciones.map(o => <option key={o.valor} value={o.valor}>{o.etiqueta}</option>)}
                  </select>
                ) : (
                  <input id={`imprt-def-${d.campo}`} className="input" type={d.tipo === 'fecha' ? 'date' : 'text'}
                    value={globales[d.campo] ?? ''}
                    onChange={e => setGlobales({ ...globales, [d.campo]: e.target.value })} />
                )}
                {d.ayuda && <span className="input-hint">{d.ayuda}</span>}
              </div>
            ))}
            <div className="input-group ter-col-span-2">
              <label htmlFor="imprt-pol">Si ya existe</label>
              <select id="imprt-pol" className="input" value={politica} onChange={e => setPolitica(e.target.value as Politica)}>
                <option value="SALTAR">Saltar (no tocar)</option>
                <option value="ACTUALIZAR">Actualizar con lo que traiga el archivo</option>
                <option value="CREAR">Crear otro</option>
              </select>
              <span className="input-hint">Al actualizar solo se escriben las columnas del archivo; lo demás se queda como está.</span>
            </div>
          </div>

          {/* Plantillas: recuerdan qué columna es cada campo en el export de un
              software concreto. No guardan los valores globales de este cliente. */}
          <div className="ter-form-grid">
            {plantillas.length > 0 && (
              <div className="input-group ter-col-span-3">
                <label htmlFor="imprt-plt">Usar un mapeo guardado</label>
                <select id="imprt-plt" className="input" defaultValue="" onChange={e => usarPlantilla(e.target.value)}>
                  <option value="">— Mapear a mano —</option>
                  {plantillas.map(p => <option key={p.plantilla_id} value={p.plantilla_id}>{p.nombre}</option>)}
                </select>
              </div>
            )}
            <div className="input-group ter-col-span-3">
              <label htmlFor="imprt-plt-nom">Guardar este mapeo para reutilizarlo</label>
              <div className="imprt-plantilla-guardar">
                <input id="imprt-plt-nom" className="input" value={nombrePlantilla} placeholder="Ej.: Export de Zoho"
                  onChange={e => setNombrePlantilla(e.target.value)} />
                <button type="button" className="btn btn-secondary" onClick={guardarPlantilla} disabled={!nombrePlantilla.trim()}>
                  <Save size={15} strokeWidth={2} /> Guardar
                </button>
              </div>
            </div>
          </div>

          <div className="imprt-mapa">
            {campos.map(c => (
              <div key={c.campo} className="imprt-map-row">
                <div className="imprt-map-campo">
                  {c.etiqueta}{c.obligatorio && <span className="required"> *</span>}
                  {c.ayuda && <span className="imprt-map-ayuda">{c.ayuda}</span>}
                </div>
                <select className="input" value={columnas[c.campo] ?? ''} aria-label={`Columna para ${c.etiqueta}`}
                  onChange={e => setColumnas({ ...columnas, [c.campo]: e.target.value })}>
                  <option value="">— No importar —</option>
                  {cabeceras.map(cab => <option key={cab} value={cab}>{cab}</option>)}
                </select>
              </div>
            ))}
          </div>

          <div className="imprt-acciones">
            <button type="button" className="btn btn-ghost" onClick={() => setPaso('subir')}>
              <ArrowLeft size={15} strokeWidth={2} /> Atrás
            </button>
            <button type="button" className="btn btn-primary" onClick={validar} disabled={cargando}>
              {cargando
                ? <><span className="spinner spinner-sm" /> Validando {etiquetaProgreso}…</>
                : <>Validar <ArrowRight size={15} strokeWidth={2} /></>}
            </button>
          </div>
        </div>
      )}

      {/* ── Paso 4: revisar (dry-run) ── */}
      {paso === 'validar' && resultado && (
        <div className="card">
          <div className="imprt-tiles">
            <div className="imprt-tile"><strong>{resultado.total}</strong><span>Filas</span></div>
            <div className="imprt-tile"><strong>{resultado.ok}</strong><span>Listas para importar</span></div>
            <div className="imprt-tile"><strong>{resultado.errores}</strong><span>Con error</span></div>
          </div>

          {/* Totales de lo que se va a escribir: un decimal mal leído se ve aquí. */}
          {resultado.resumen.length > 0 && (
            <>
              <p className="modal-body-text">Comprueba que estos totales son los que esperas antes de importar.</p>
              <div className="imprt-tiles">
                {resultado.resumen.map(t => (
                  <div key={t.etiqueta} className="imprt-tile"><strong>{formatearImporte(t.valor)}</strong><span>{t.etiqueta}</span></div>
                ))}
              </div>
            </>
          )}

          {resultado.errores > 0 && (
            <>
              <div className="alert alert-warning">
                <AlertTriangle size={16} strokeWidth={2} /> Hay {resultado.errores} filas con problemas. Se importarán solo las correctas; corrige el resto y vuelve a subirlas.
              </div>
              <button type="button" className="btn btn-secondary btn-sm" onClick={descargarErrores}>
                <Download size={14} strokeWidth={2} /> Descargar errores
              </button>
              <div className="card-table">
                <div className="table-wrapper">
                  <table className="table">
                    <thead><tr><th className="col-num">Fila</th><th>Motivo</th></tr></thead>
                    <tbody>
                      {resultado.filas.slice(0, 100).map(f => (
                        <tr key={f.fila}>
                          <td data-label="Fila" className="col-num">{f.fila}</td>
                          <td data-label="Motivo">{f.motivo}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}

          <div className="imprt-acciones">
            <button type="button" className="btn btn-ghost" onClick={() => setPaso('mapear')}>
              <ArrowLeft size={15} strokeWidth={2} /> Atrás
            </button>
            <button type="button" className="btn btn-primary" onClick={aplicar} disabled={cargando || resultado.ok === 0}>
              {cargando
                ? <><span className="spinner spinner-sm" /> Importando {etiquetaProgreso}…</>
                : <>Importar {resultado.ok} filas</>}
            </button>
          </div>
        </div>
      )}

      {/* ── Paso 5: listo ── */}
      {paso === 'hecho' && resumen && (
        <div className="card">
          <div className="alert alert-success"><CheckCircle2 size={16} strokeWidth={2} /> Importación completada.</div>
          <div className="imprt-tiles">
            <div className="imprt-tile"><strong>{resumen.insertadas}</strong><span>Creadas</span></div>
            <div className="imprt-tile"><strong>{resumen.actualizadas}</strong><span>Actualizadas</span></div>
            <div className="imprt-tile"><strong>{resumen.saltadas}</strong><span>Saltadas</span></div>
            <div className="imprt-tile"><strong>{resumen.errores}</strong><span>Con error</span></div>
          </div>

          {deshecho && (
            deshecho.intactas === 0
              ? <div className="alert alert-success"><CheckCircle2 size={16} strokeWidth={2} /> Se deshicieron {deshecho.deshechas} filas. Puedes corregir el archivo y volver a importarlo.</div>
              : (
                <>
                  <div className="alert alert-warning">
                    <AlertTriangle size={16} strokeWidth={2} /> Se deshicieron {deshecho.deshechas}, pero {deshecho.intactas} se quedaron como estaban.
                  </div>
                  <div className="card-table">
                    <div className="table-wrapper">
                      <table className="table">
                        <thead><tr><th className="col-num">Fila</th><th>Por qué no se pudo deshacer</th></tr></thead>
                        <tbody>
                          {deshecho.motivos.slice(0, 50).map(m => (
                            <tr key={m.fila}>
                              <td data-label="Fila" className="col-num">{m.fila}</td>
                              <td data-label="Por qué no se pudo deshacer">{m.motivo}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </>
              )
          )}

          <div className="imprt-acciones">
            <button type="button" className="btn btn-danger-text" onClick={() => setConfirmarDeshacer(true)}
              disabled={cargando || resumen.insertadas === 0 || (!!deshecho && deshecho.intactas === 0)}>
              <Undo2 size={15} strokeWidth={2} /> Deshacer esta importación
            </button>
            <div className="imprt-acciones-fin">
              <button type="button" className="btn btn-secondary" onClick={reiniciar}>Importar otro archivo</button>
              {destino && <Link className="btn btn-primary" href={destino}>Ver {etiquetaEnt.toLowerCase()}</Link>}
            </div>
          </div>
        </div>
      )}

      {confirmarDeshacer && (
        <ConfirmDialog
          title="¿Deshacer esta importación?"
          body={<>Se quitará lo que creó este archivo ({resumen?.insertadas} filas). Lo que ya se esté usando —o el stock que ya se haya movido— se queda como está y se te dirá cuál. Lo actualizado no se revierte.</>}
          confirmLabel="Deshacer"
          danger
          onConfirm={deshacer}
          onCancel={() => setConfirmarDeshacer(false)}
        />
      )}
    </div>
  )
}
