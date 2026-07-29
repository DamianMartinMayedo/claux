'use client'

import { useRef, useState } from 'react'
import Link from 'next/link'
import { toastError, toastSuccess, toastLoading } from '@/app/contexts/ToastContext'
import { ArrowLeft, ArrowRight, Check, CheckCircle2, AlertTriangle, Download, FileSpreadsheet, HelpCircle, Save, Undo2 } from 'lucide-react'
import { ConfirmDialog } from '@/components/portal/Dialog'
import { formatearImporte, fusionarTotales } from '@/lib/importador/util'
import type { Pendiente, Resolucion } from '@/lib/importador/tipos'
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
type FilaMala = { fila: number; ok: boolean; motivo?: string; decidir?: boolean }
type Total    = { etiqueta: string; valor: number; entero?: boolean }

// Maestros primero, estado financiero después: el orden de la lista es el orden
// en que conviene importar (lo de abajo se apoya en lo de arriba).
const ENTIDADES = [
  { id: 'terceros',        etiqueta: 'Clientes y proveedores', desc: 'Terceros con contacto y datos de pago.',      disponible: true, destino: '/portal/terceros' },
  { id: 'productos',       etiqueta: 'Productos',              desc: 'Catálogo físico: precios, costos y unidad.',   disponible: true, destino: '/portal/productos' },
  { id: 'servicios',       etiqueta: 'Servicios',              desc: 'Catálogo de servicios y suscribibles.',        disponible: true, destino: '/portal/servicios' },
  { id: 'suscripciones',   etiqueta: 'Suscripciones',          desc: 'Acuerdos recurrentes por cliente. Requiere los servicios ya creados o creables al vuelo.', disponible: true, destino: '/portal/suscripciones' },
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
 * Junta los nombres por decidir de todas las tandas: el mismo nombre sale en
 * muchas filas y se pregunta UNA vez, con la cuenta de filas sumada.
 */
function fusionarPendientes(acumulado: Pendiente[], nuevos: Pendiente[]): Pendiente[] {
  const mapa = new Map(acumulado.map(p => [p.clave, p]))
  for (const p of nuevos) {
    const ya = mapa.get(p.clave)
    if (ya) ya.filas += p.filas
    else    mapa.set(p.clave, { ...p })
  }
  return [...mapa.values()]
}

/**
 * Agrupa filas con error por motivo IDÉNTICO: la misma causa repetida en 40
 * filas (p. ej. «no existe el proveedor "Otros"» rechazada fila a fila) se lee
 * mejor como una línea con un contador que como 40 filas iguales.
 */
function agruparPorMotivo(filas: FilaMala[]): { motivo: string; filas: number[] }[] {
  const mapa = new Map<string, number[]>()
  for (const f of filas) {
    const motivo = f.motivo ?? '—'
    const ya = mapa.get(motivo)
    if (ya) ya.push(f.fila)
    else    mapa.set(motivo, [f.fila])
  }
  return [...mapa.entries()].map(([motivo, filas]) => ({ motivo, filas }))
}

/** «1, 2, 3 y 12 más» en vez de una lista que puede tener cientos de números. */
function textoFilas(filas: number[]): string {
  const MAX = 15
  return filas.length <= MAX ? filas.join(', ') : `${filas.slice(0, MAX).join(', ')} y ${filas.length - MAX} más`
}

/** Por encima de esto, vincular una a una deja de ahorrar tiempo frente a
 *  corregir el archivo de origen: se retira el panel y se enseña un resumen. */
const TOPE_COTEJO = 50

/** El valor del desplegable de un pendiente ⇄ la decisión que representa. */
function aValor(r: Resolucion | undefined): string {
  if (!r) return ''
  return r.accion === 'USAR' ? `USAR|${r.destino ?? ''}` : r.accion
}

function aResolucion(valor: string): Resolucion | null {
  if (!valor) return null
  const [accion, destino] = valor.split('|')
  return accion === 'USAR'
    ? { accion: 'USAR', destino }
    : { accion: accion as Resolucion['accion'] }
}

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

/**
 * Los nombres del archivo que no cuadraron, con lo que se puede hacer con cada
 * uno. Dos bloques, y la diferencia entre ellos es la que evita los 80 clics:
 *
 *  · «Hay que decidir» — o hay más de una ficha con ese nombre, o hay una que se
 *    le PARECE. Emparejar a ciegas metería el dinero en la partida equivocada y
 *    crear a ciegas duplicaría lo que ya existe escrito de otra forma. Estas
 *    filas no se importan hasta que se responde.
 *  · «Se crearán solas» — no se parecen a nada, así que manda la política del
 *    lote. Salen listadas de todos modos, porque «se va a crear una categoría
 *    nueva» es algo que el dueño tiene derecho a ver antes, y se pueden
 *    redirigir a una existente desde el mismo desplegable.
 */
function PanelPendientes({
  pendientes, resoluciones, onDecidir, onRevalidar, cargando, etiquetaProgreso,
}: {
  pendientes:   Pendiente[]
  resoluciones: Record<string, Resolucion>
  onDecidir:    (clave: string, valor: string) => void
  onRevalidar:  () => void
  cargando:     boolean
  etiquetaProgreso: string
}) {
  const urgentes = pendientes.filter(p => p.decidir)
  const deOficio = pendientes.filter(p => !p.decidir)
  const sinRespuesta = urgentes.filter(p => !resoluciones[p.clave]).length

  const fila = (p: Pendiente) => (
    <div key={p.clave} className="imprt-map-row">
      <div className="imprt-map-campo">
        <strong className="imprt-pend-nombre">«{p.texto}»</strong>
        <span className="imprt-map-ayuda">
          {p.etiqueta_tipo}
          {p.ambito_etiqueta ? ` ${p.ambito_etiqueta}` : ''}
          {' · '}
          {p.filas === 1 ? `fila ${p.primera_fila}` : `${p.filas} filas (desde la ${p.primera_fila})`}
          {p.causa === 'VARIAS' ? ' · hay más de una con ese nombre' : ''}
        </span>
        {p.aviso && <span className="imprt-pend-aviso">{p.aviso}</span>}
      </div>
      <select className="input" value={aValor(resoluciones[p.clave])}
        aria-label={`Qué hacer con ${p.texto}`}
        onChange={e => onDecidir(p.clave, e.target.value)}>
        <option value="">— Elige qué es —</option>
        {p.opciones.map(o => (
          <option key={o.valor} value={`USAR|${o.valor}`}>Es «{o.etiqueta}»</option>
        ))}
        {p.creable  && <option value="CREAR">Crear «{p.texto}»</option>}
        {p.omitible && <option value="OMITIR">Dejarlo en blanco</option>}
        <option value="RECHAZAR">Dejar estas filas fuera</option>
      </select>
    </div>
  )

  return (
    <div className="imprt-pend">
      {urgentes.length > 0 && (
        <>
          <div className="alert alert-warning">
            <HelpCircle size={16} strokeWidth={2} />
            {urgentes.length === 1
              ? 'Hay un nombre del archivo que se parece a algo que ya tienes, pero no es igual. Dinos qué es.'
              : `Hay ${urgentes.length} nombres del archivo que se parecen a algo que ya tienes, pero no son iguales. Dinos qué son.`}
          </div>
          <div className="imprt-mapa">{urgentes.map(fila)}</div>
        </>
      )}

      {deOficio.length > 0 && (
        <details className="imprt-pend-mas">
          <summary>
            {deOficio.length === 1
              ? 'Un nombre nuevo que se dará de alta'
              : `${deOficio.length} nombres nuevos que se darán de alta`}
          </summary>
          <p className="input-hint">
            No se parecen a nada de lo que ya tienes, así que se crean según lo que elegiste al mapear.
            Si alguno era en realidad uno de los que ya existen, cámbialo aquí.
          </p>
          <div className="imprt-mapa">{deOficio.map(fila)}</div>
        </details>
      )}

      <div className="imprt-pend-acciones">
        <button type="button" className="btn btn-secondary" onClick={onRevalidar} disabled={cargando}>
          {cargando
            ? <><span className="spinner spinner-sm" /> Validando {etiquetaProgreso}…</>
            : <>Volver a validar con estas decisiones</>}
        </button>
        {sinRespuesta > 0 && (
          <span className="input-hint">
            {sinRespuesta === 1
              ? 'Queda 1 sin responder: sus filas se quedarán fuera.'
              : `Quedan ${sinRespuesta} sin responder: sus filas se quedarán fuera.`}
          </span>
        )}
      </div>
    </div>
  )
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

  const [resultado, setResultado] = useState<{
    total: number; ok: number; errores: number; por_decidir: number
    filas: FilaMala[]; resumen: Total[]; pendientes: Pendiente[]
  } | null>(null)
  // Decisiones sobre los nombres que el archivo no emparejó. Viajan en el mapeo,
  // así que revalidar y aplicar recorren el mismo camino.
  const [resoluciones, setResoluciones] = useState<Record<string, Resolucion>>({})
  const [resumen, setResumen]     = useState<{ insertadas: number; actualizadas: number; saltadas: number; errores: number } | null>(null)
  // Lo que el lote creó DE PASO (proveedores, categorías, clientes o servicios
  // que una fila nombraba y no existían): solo llega en la última tanda.
  const [auxiliares, setAuxiliares] = useState<{ etiqueta: string; cantidad: number }[]>([])

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
    setResoluciones({})
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
      // Lo revisado —y lo decidido— era del archivo anterior.
      setAvisos(res.avisos ?? []); setResultado(null); setResoluciones({})
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

  /**
   * Dry-run. `resol` se pasa explícito al revalidar tras decidir: leer el estado
   * aquí daría el de antes del último clic.
   */
  async function validar(resol: Record<string, Resolucion> = resoluciones) {
    const falta = defs.find(d => d.obligatorio && !(globales[d.campo] ?? '').trim())
    if (falta) { toastError(`Indica ${falta.etiqueta.toLowerCase()}.`); return }
    const mapeo = {
      columnas,
      defaults: Object.fromEntries(Object.entries(globales).filter(([, v]) => v.trim() !== '')),
      politica,
      resoluciones: resol,
    }
    setCargando(true)
    const ld = toastLoading('Validando…')
    // El archivo se valida en tandas (una consulta por fila): se llama en bucle
    // hasta que el servidor dice que no queda nada, enseñando el avance.
    const acc = {
      total, ok: 0, errores: 0, por_decidir: 0,
      filas: [] as FilaMala[], resumen: [] as Total[], pendientes: [] as Pendiente[],
    }
    let desde: number | null = 0
    let claves: string[] = []
    while (desde !== null) {
      const res = await validarLoteImport(loteId, mapeo, desde, claves)
      if (!res.ok || !res.trozo) { await ld.dismiss(); setCargando(false); setProgreso(null); toastError(res.error ?? 'Error al validar.'); return }
      const t = res.trozo
      acc.total = t.total; acc.ok += t.ok; acc.errores += t.errores; acc.por_decidir += t.por_decidir
      acc.filas.push(...t.filas.filter(f => !f.ok))   // las buenas no se pintan: solo cuentan
      acc.resumen    = fusionarTotales(acc.resumen, t.resumen ?? [])
      acc.pendientes = fusionarPendientes(acc.pendientes, t.pendientes ?? [])
      claves = t.claves
      desde  = t.siguiente
      setProgreso(desde === null ? null : { hechas: desde, total: t.total })
    }
    await ld.dismiss()
    setCargando(false)
    // Lo que aún no se ha decidido arranca con la respuesta por defecto: así el
    // desplegable enseña lo que va a pasar, no un hueco.
    setResoluciones({
      ...Object.fromEntries(acc.pendientes
        .filter(p => !p.decidir)
        .map(p => [p.clave, { accion: p.defecto } as Resolucion])),
      ...resol,
    })
    setResultado(acc); setPaso('validar')
  }

  /** Guarda una decisión. No revalida sola: son N consultas y la conexión es la que es. */
  function decidir(clave: string, valor: string) {
    const r = aResolucion(valor)
    setResoluciones(prev => {
      const siguiente = { ...prev }
      if (r) siguiente[clave] = r
      else   delete siguiente[clave]
      return siguiente
    })
  }

  async function aplicar() {
    setCargando(true)
    const ld = toastLoading('Importando…')
    const acc = { insertadas: 0, actualizadas: 0, saltadas: 0, errores: 0 }
    let aux: { etiqueta: string; cantidad: number }[] = []
    let desde: number | null = 0
    let claves: string[] = []
    while (desde !== null) {
      const res = await aplicarLoteImport(loteId, desde, claves)
      if (!res.ok || !res.trozo) { await ld.dismiss(); setCargando(false); setProgreso(null); toastError(res.error ?? 'Error al importar.'); return }
      const t = res.trozo
      acc.insertadas += t.insertadas; acc.actualizadas += t.actualizadas
      acc.saltadas   += t.saltadas;   acc.errores      += t.errores
      if (res.auxiliares) aux = res.auxiliares   // solo llega en la última tanda
      claves = t.claves
      desde  = t.siguiente
      setProgreso(desde === null ? null : { hechas: desde, total: resultado?.total ?? total })
    }
    await ld.dismiss()
    setCargando(false)
    setResumen(acc); setAuxiliares(aux); setPaso('hecho')
  }

  /** Solo los errores de verdad: lo que espera una decisión se resuelve arriba. */
  const malas = resultado?.filas.filter(f => !f.decidir) ?? []
  const erroresAgrupados = agruparPorMotivo(malas)
  const urgentes = resultado?.pendientes.filter(p => p.decidir) ?? []

  function descargarErrores() {
    descargarCsv(`errores-${loteId}.csv`,
      'fila,motivo\n' + malas.map(e => `${e.fila},${celdaCsv(e.motivo ?? '')}`).join('\n') + '\n')
  }

  function reiniciar() {
    setPaso('entidad'); setEntidad(''); setCampos([]); setDefs([]); setLoteId(''); setCabeceras([]); setTotal(0)
    setColumnas({}); setGlobales({}); setResultado(null); setResumen(null); setPolitica('SALTAR')
    setPlantillas([]); setNombrePlantilla(''); setDeshecho(null); setAvisos([]); setProgreso(null)
    setResoluciones({}); setAuxiliares([])
  }

  const etiquetaProgreso = progreso ? `${progreso.hechas} de ${progreso.total}` : ''

  return (
    <div className="view-container">
      <div className="page-header">
        <div>
          <h1 className="page-title">Importar datos</h1>
          <p className="page-subtitle">Carga masiva de tus datos desde un archivo CSV o Excel.</p>
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
          <div className="alert alert-info alert-intro">
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
            <button type="button" className="btn btn-primary" onClick={() => validar()} disabled={cargando}>
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
            {resultado.por_decidir > 0 && (
              <div className="imprt-tile"><strong>{resultado.por_decidir}</strong><span>Esperan que decidas</span></div>
            )}
            <div className="imprt-tile"><strong>{resultado.errores}</strong><span>Con error</span></div>
          </div>

          {/* Nombres que el archivo trae y no cuadran con nada. Se pregunta en vez
              de emparejar por parecido: clasificar un gasto en la categoría
              equivocada mete dinero en el renglón que no toca del informe. Por
              encima del tope, vincular una a una deja de ahorrar tiempo frente a
              corregir el archivo de origen: se retira el panel interactivo y se
              enseña un resumen agrupado, igual que la tabla de errores de abajo. */}
          {resultado.pendientes.length > 0 && (
            urgentes.length > TOPE_COTEJO ? (
              <div className="imprt-pend">
                <div className="alert alert-warning">
                  <AlertTriangle size={16} strokeWidth={2} />
                  Hay {urgentes.length} incompatibilidades distintas por resolver: son demasiadas para
                  vincularlas aquí una a una. Corrige el archivo de origen (o divídelo en partes más
                  pequeñas) y vuelve a subirlo.
                </div>
                <div className="card-table">
                  <div className="table-wrapper">
                    <table className="table">
                      <thead><tr><th className="col-num">Filas</th><th>Qué no cuadra</th></tr></thead>
                      <tbody>
                        {urgentes.map(p => (
                          <tr key={p.clave}>
                            <td data-label="Filas" className="col-num">{p.filas}</td>
                            <td data-label="Qué no cuadra">
                              «{p.texto}» — {p.etiqueta_tipo.toLowerCase()}{p.ambito_etiqueta ? ` ${p.ambito_etiqueta}` : ''}
                              {p.causa === 'VARIAS' ? ' (hay más de una con ese nombre)' : ''}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            ) : (
              <PanelPendientes
                pendientes={resultado.pendientes}
                resoluciones={resoluciones}
                onDecidir={decidir}
                onRevalidar={() => validar(resoluciones)}
                cargando={cargando}
                etiquetaProgreso={etiquetaProgreso}
              />
            )
          )}

          {/* Totales de lo que se va a escribir: un decimal mal leído se ve aquí. */}
          {resultado.resumen.length > 0 && (
            <>
              <p className="modal-body-text">Comprueba que estos totales son los que esperas antes de importar.</p>
              <div className="imprt-tiles">
                {resultado.resumen.map(t => (
                  <div key={t.etiqueta} className="imprt-tile">
                    {/* Las cuentas de filas van sin decimales: «3 filas», no «3,00». */}
                    <strong>{t.entero ? t.valor : formatearImporte(t.valor)}</strong>
                    <span>{t.etiqueta}</span>
                  </div>
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
                    <thead><tr><th className="col-num">Filas</th><th>Motivo</th></tr></thead>
                    <tbody>
                      {erroresAgrupados.map(g => (
                        <tr key={g.motivo}>
                          <td data-label="Filas" className="col-num">{g.filas.length === 1 ? g.filas[0] : `${g.filas.length} filas`}</td>
                          <td data-label="Motivo">
                            {g.motivo}
                            {g.filas.length > 1 && <span className="input-hint"> — {textoFilas(g.filas)}</span>}
                          </td>
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

          {/* Lo que el archivo NOMBRABA y no existía todavía (un cliente, un
              proveedor, una categoría, un servicio…): no es una fila del
              archivo, así que no sale arriba, y conviene saber qué más tocó
              la importación antes de darla por revisada. */}
          {auxiliares.length > 0 && (
            <>
              <p className="modal-body-text">De paso, esta importación creó (o reactivó):</p>
              <div className="imprt-tiles">
                {auxiliares.map(a => (
                  <div key={a.etiqueta} className="imprt-tile"><strong>{a.cantidad}</strong><span>{a.etiqueta}</span></div>
                ))}
              </div>
            </>
          )}

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
                          {/* La fila 0 es una ficha que creó el archivo sin ser una fila suya
                              (el proveedor de un gasto): no tiene número, y puede haber varias. */}
                          {deshecho.motivos.slice(0, 50).map((m, i) => (
                            <tr key={`${m.fila}-${i}`}>
                              <td data-label="Fila" className="col-num">{m.fila || '—'}</td>
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
