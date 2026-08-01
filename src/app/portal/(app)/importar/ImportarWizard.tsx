'use client'

import { useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { toastError, toastSuccess, toastLoading } from '@/app/contexts/ToastContext'
import { ArrowLeft, ArrowRight, Check, CheckCircle2, AlertTriangle, Download, FileSpreadsheet, Save, Undo2 } from 'lucide-react'
import { ConfirmDialog } from '@/components/portal/Dialog'
import { formatearImporte, fusionarTotales } from '@/lib/importador/util'
import { aBase64 } from '@/lib/subir-archivo'
import type {
  ClavesVistas, DecisionRepetidas, FilaRepetida, Pendiente, Resolucion,
} from '@/lib/importador/tipos'
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

/** Lo que devuelve un botón o el buscador ⇄ la decisión que representa. */
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

/**
 * Elegir una ficha entre las que ya existen, BUSCANDO en vez de desplegando.
 *
 * El desplegable anterior listaba TODAS las fichas del cliente: con trescientos
 * clientes es inservible, y en Android un `select` largo abre un selector del
 * sistema con las trescientas. Aquí se ofrecen las más parecidas —el emparejado
 * ya las ordena por parecido, y la buena está casi siempre entre las dos
 * primeras— y el resto se alcanza escribiendo.
 *
 * Reusa la familia `.ac-*` del portal (el patrón de autocompletado del design
 * system) con sus detalles ya resueltos: blur con retardo —sin él el clic en una
 * sugerencia no llega a registrarse—, ↑/↓/Enter/Escape, y Enter que ELIGE y no
 * envía nada.
 */
function BuscarFicha({
  opciones, elegida, etiquetaTipo, onElegir,
}: {
  opciones:     { valor: string; etiqueta: string }[]
  elegida:      { valor: string; etiqueta: string } | undefined
  etiquetaTipo: string
  onElegir:     (valor: string) => void
}) {
  const [texto, setTexto]     = useState('')
  const [abierto, setAbierto] = useState(false)
  const [activo, setActivo]   = useState(0)

  const sugerencias = useMemo(() => {
    const t = normaliza(texto)
    return opciones.filter(o => !t || normaliza(o.etiqueta).includes(t)).slice(0, 6)
  }, [texto, opciones])

  const visible = abierto && sugerencias.length > 0

  function elegir(o: { valor: string; etiqueta: string }) {
    onElegir(o.valor)
    setTexto(o.etiqueta)
    setAbierto(false)
  }

  function teclas(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!visible) return
    if (e.key === 'ArrowDown') { e.preventDefault(); setActivo(i => (i + 1) % sugerencias.length); return }
    if (e.key === 'ArrowUp')   { e.preventDefault(); setActivo(i => (i - 1 + sugerencias.length) % sugerencias.length); return }
    if (e.key === 'Escape')    { setAbierto(false); return }
    if (e.key === 'Enter')     { e.preventDefault(); elegir(sugerencias[activo]) }
  }

  return (
    <div className="ac-wrap">
      <input
        className="input"
        type="text"
        autoComplete="off"
        aria-label={`Buscar entre tus ${etiquetaTipo.toLowerCase()}s`}
        placeholder={opciones.length > 6
          ? `Busca entre tus ${opciones.length} fichas…`
          : 'Busca la ficha que es…'}
        value={texto || elegida?.etiqueta || ''}
        onChange={e => { setTexto(e.target.value); setAbierto(true); setActivo(0) }}
        onFocus={() => setAbierto(true)}
        onBlur={() => setTimeout(() => setAbierto(false), 120)}
        onKeyDown={teclas}
      />
      {visible && (
        <ul className="ac-lista" role="listbox">
          {sugerencias.map((o, i) => (
            <li key={o.valor}>
              <button type="button"
                className={`ac-item${i === activo ? ' active' : ''}`}
                onMouseDown={e => { e.preventDefault(); elegir(o) }}
                onMouseEnter={() => setActivo(i)}>
                <span className="ac-nom">{o.etiqueta}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/**
 * Lo que se ha decidido sobre un nombre, EN CONSECUENCIAS. El control solo
 * enseñaba la opción marcada, así que elegir «Crear X» no se distinguía de no
 * haber tocado nada. Esta línea es el acuse de recibo.
 */
function consecuencia(p: Pendiente, r: Resolucion | undefined): string | null {
  if (!r) return null
  if (r.accion === 'CREAR')  return `Se creará «${p.texto}»`
  if (r.accion === 'OMITIR') return 'Se dejará en blanco'
  if (r.accion === 'RECHAZAR') return `Sus ${p.filas === 1 ? 'fila' : `${p.filas} filas`} se quedarán fuera`
  const elegida = p.opciones.find(o => o.valor === r.destino)?.etiqueta
  return elegida ? `Se usará «${elegida}»` : null
}

/**
 * Un nombre del archivo y qué hacer con él.
 *
 * Buscar una ficha y decidir una acción son DOS cosas distintas, y antes
 * competían dentro del mismo desplegable: «Crear «Yarini SURL»» aparecía en la
 * posición 301, detrás de trescientos nombres de clientes. Ahora el buscador
 * busca fichas y las acciones son botones a la vista.
 */
function FilaPendiente({
  p, resolucion, sinAplicar, onDecidir,
}: {
  p:           Pendiente
  resolucion:  Resolucion | undefined
  sinAplicar:  boolean
  onDecidir:   (clave: string, valor: string) => void
}) {
  const elegida = resolucion?.accion === 'USAR'
    ? p.opciones.find(o => o.valor === resolucion.destino)
    : undefined
  const activa = (a: string) => resolucion?.accion === a ? 'btn-primary' : 'btn-secondary'
  const texto  = consecuencia(p, resolucion)

  return (
    <div className="imprt-pend-ficha">
      <div className="imprt-pend-quien">
        <strong className="imprt-pend-nombre">«{p.texto}»</strong>
        <span className="imprt-map-ayuda">
          {p.etiqueta_tipo}
          {p.ambito_etiqueta ? ` ${p.ambito_etiqueta}` : ''}
          {' · '}
          {p.filas === 1 ? `fila ${p.primera_fila}` : `${p.filas} filas (desde la ${p.primera_fila})`}
          {p.causa === 'VARIAS' ? ' · hay más de una con ese nombre' : ''}
        </span>
      </div>

      {p.opciones.length > 0 && (
        <BuscarFicha
          opciones={p.opciones}
          elegida={elegida}
          etiquetaTipo={p.etiqueta_tipo}
          onElegir={v => onDecidir(p.clave, `USAR|${v}`)}
        />
      )}

      <div className="imprt-pend-botones">
        {p.creable  && (
          <button type="button" className={`btn btn-sm ${activa('CREAR')}`}
            onClick={() => onDecidir(p.clave, 'CREAR')}>Crear ficha nueva</button>
        )}
        {p.omitible && (
          <button type="button" className={`btn btn-sm ${activa('OMITIR')}`}
            onClick={() => onDecidir(p.clave, 'OMITIR')}>Dejarlo en blanco</button>
        )}
        <button type="button" className={`btn btn-sm ${activa('RECHAZAR')}`}
          onClick={() => onDecidir(p.clave, 'RECHAZAR')}>Dejar sus filas fuera</button>
      </div>

      {p.aviso && resolucion?.accion === 'CREAR' && <span className="imprt-pend-aviso">{p.aviso}</span>}
      {texto && (
        <span className="imprt-pend-decidido">
          <Check size={13} strokeWidth={2.5} />
          {texto}
          {sinAplicar && <em> · pendiente de recalcular</em>}
        </span>
      )}
    </div>
  )
}

/**
 * Los nombres del archivo que NO cuadran con nada y hay que decidir: o existe más
 * de una ficha con ese nombre, o hay una que se le PARECE. Emparejar a ciegas
 * metería el dinero en la partida equivocada y crear a ciegas duplicaría lo que ya
 * existe escrito de otra forma. Estas filas no se importan hasta que se responde.
 *
 * Los que no se parecen a nada NO están aquí: se crean solos según la política del
 * lote, no preguntan nada, y mezclar «contéstame» con «te informo» en la misma
 * tarjeta era la mitad de la confusión de este paso. Van a «Qué va a pasar».
 */
function PanelPendientes({
  pendientes, resoluciones, sinAplicar, onDecidir,
}: {
  pendientes:   Pendiente[]
  resoluciones: Record<string, Resolucion>
  sinAplicar:   string[]
  onDecidir:    (clave: string, valor: string) => void
}) {
  const sinRespuesta = pendientes.filter(p => !resoluciones[p.clave]).length

  return (
    <div className="card imprt-pend">
      <div className="card-header">
        <h2 className="card-title card-title-sm">Nombres que no acabamos de reconocer</h2>
        <span className="text-xs-muted">
          {pendientes.length === 1 ? '1 nombre' : `${pendientes.length} nombres`}
        </span>
      </div>

      <p className="modal-body-text">
        {pendientes.length === 1
          ? 'Se parece a algo que ya tienes, pero no es igual. Dinos qué es.'
          : 'Se parecen a algo que ya tienes, pero no son iguales. Dinos qué son.'}
      </p>

      <div className="imprt-pend-lista">
        {pendientes.map(p => (
          <FilaPendiente key={p.clave} p={p}
            resolucion={resoluciones[p.clave]}
            sinAplicar={sinAplicar.includes(p.clave)}
            onDecidir={onDecidir} />
        ))}
      </div>

      {sinRespuesta > 0 && (
        <p className="input-hint">
          {sinRespuesta === 1
            ? 'Queda 1 sin responder: sus filas se quedarán fuera.'
            : `Quedan ${sinRespuesta} sin responder: sus filas se quedarán fuera.`}
        </p>
      )}
    </div>
  )
}

/**
 * Filas que dicen lo mismo que otra fila del archivo.
 *
 * No es un error y no se puede adivinar: dos facturas al mismo cliente, el mismo
 * día y por el mismo importe existen de verdad. Así que se enfrentan las dos
 * filas, se enseña EN QUÉ SE DIFERENCIAN —que es lo único que permite decidir sin
 * abrir el Excel— y se pregunta una sola vez para todas.
 */
function PanelRepetidas({
  repetidas, decision, sinAplicar, onDecidir,
}: {
  repetidas:  FilaRepetida[]
  decision:   DecisionRepetidas
  sinAplicar: boolean
  onDecidir:  (d: DecisionRepetidas) => void
}) {
  // Idénticas en todo lo mapeado: ahí no hay nada que decidir y decirlo evita que
  // el operador busque una diferencia que no existe.
  const gemelasExactas = repetidas.filter(r => r.difieren.length === 0).length

  return (
    <div className="card">
      <div className="card-header">
        <h2 className="card-title card-title-sm">Filas que dicen lo mismo que otra</h2>
        <span className="text-xs-muted">
          {repetidas.length === 1 ? '1 fila' : `${repetidas.length} filas`}
        </span>
      </div>

      <p className="modal-body-text">
        Compáralas y dinos si son cosas distintas o la misma escrita dos veces.
      </p>

      <ul className="imprt-rep">
        {repetidas.slice(0, 20).map(r => (
          <li key={r.fila} className="imprt-rep-item">
            <strong className="imprt-rep-filas">Fila {r.fila} = fila {r.gemela}</strong>
            <span className="imprt-map-ayuda">{r.resumen}</span>
            {r.difieren.length === 0 ? (
              <span className="imprt-pend-aviso">
                Son idénticas en todo lo que trae el archivo. Si de verdad son dos, añade algo que
                las diferencie (el nº de documento) antes de importar.
              </span>
            ) : (
              <span className="imprt-rep-difieren">
                Solo se diferencian en{' '}
                {r.difieren.map((d, i) => (
                  <span key={d.etiqueta}>
                    {i > 0 && ', '}
                    {d.etiqueta.toLowerCase()}: «{d.aqui}» / «{d.alli}»
                  </span>
                ))}
              </span>
            )}
          </li>
        ))}
      </ul>
      {repetidas.length > 20 && (
        <p className="input-hint">Y {repetidas.length - 20} más. La decisión vale para todas.</p>
      )}

      <div className="imprt-pend-botones">
        <button type="button" className={`btn btn-sm ${decision === 'DISTINTAS' ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => onDecidir('DISTINTAS')}>
          Son distintas: impórtalas
        </button>
        <button type="button" className={`btn btn-sm ${decision === 'FUERA' ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => onDecidir('FUERA')}>
          Es la misma: déjala fuera
        </button>
      </div>

      {decision !== 'DECIDIR' && (
        <span className="imprt-pend-decidido">
          <Check size={13} strokeWidth={2.5} />
          {decision === 'DISTINTAS'
            ? `Se importarán ${repetidas.length === 1 ? 'las dos' : 'todas'} como registros distintos.`
            : `Se quedará solo la primera de cada pareja: ${repetidas.length} ${repetidas.length === 1 ? 'fila queda' : 'filas quedan'} fuera.`}
          {sinAplicar && <em> · pendiente de recalcular</em>}
        </span>
      )}
      {gemelasExactas > 0 && (
        <p className="input-hint">
          {gemelasExactas === 1
            ? '1 de ellas es idéntica a su gemela: aunque digas que son distintas, no hay forma de guardarlas por separado.'
            : `${gemelasExactas} son idénticas a su gemela: aunque digas que son distintas, no hay forma de guardarlas por separado.`}
        </p>
      )}
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
    filas: FilaMala[]; resumen: Total[]; pendientes: Pendiente[]; repetidas: FilaRepetida[]
  } | null>(null)
  // Decisiones sobre los nombres que el archivo no emparejó. Viajan en el mapeo,
  // así que revalidar y aplicar recorren el mismo camino.
  const [resoluciones, setResoluciones] = useState<Record<string, Resolucion>>({})
  // Decisiones tomadas y todavía SIN aplicar: elegir en un desplegable no cambia
  // nada hasta revalidar, y sin esta marca parecía que el clic no hacía nada.
  const [sinAplicar, setSinAplicar] = useState<string[]>([])
  // Qué son las filas que dicen lo mismo que otra. Viaja en el mapeo, como las
  // resoluciones, para que revalidar y aplicar tomen el mismo camino.
  const [repetidas, setRepetidas] = useState<DecisionRepetidas>('DECIDIR')
  // La última decisión que SÍ viajó al servidor. Comparándola con la de arriba se
  // sabe si las cifras que se están enseñando ya la incluyen.
  const [repetidasAplicadas, setRepetidasAplicadas] = useState<DecisionRepetidas>('DECIDIR')
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
  async function validar(
    resol: Record<string, Resolucion> = resoluciones,
    rep:   DecisionRepetidas = repetidas,
  ) {
    const falta = defs.find(d => d.obligatorio && !(globales[d.campo] ?? '').trim())
    if (falta) { toastError(`Indica ${falta.etiqueta.toLowerCase()}.`); return }
    const mapeo = {
      columnas,
      defaults: Object.fromEntries(Object.entries(globales).filter(([, v]) => v.trim() !== '')),
      politica,
      resoluciones: resol,
      repetidas:    rep,
    }
    setCargando(true)
    const ld = toastLoading('Validando…')
    // El archivo se valida en tandas (una consulta por fila): se llama en bucle
    // hasta que el servidor dice que no queda nada, enseñando el avance.
    const acc = {
      total, ok: 0, errores: 0, por_decidir: 0,
      filas: [] as FilaMala[], resumen: [] as Total[], pendientes: [] as Pendiente[],
      repetidas: [] as FilaRepetida[],
    }
    let desde: number | null = 0
    let claves: ClavesVistas = []
    while (desde !== null) {
      const res = await validarLoteImport(loteId, mapeo, desde, claves)
      if (!res.ok || !res.trozo) { await ld.dismiss(); setCargando(false); setProgreso(null); toastError(res.error ?? 'Error al validar.'); return }
      const t = res.trozo
      acc.total = t.total; acc.ok += t.ok; acc.errores += t.errores; acc.por_decidir += t.por_decidir
      acc.filas.push(...t.filas.filter(f => !f.ok))   // las buenas no se pintan: solo cuentan
      acc.resumen    = fusionarTotales(acc.resumen, t.resumen ?? [])
      acc.pendientes = fusionarPendientes(acc.pendientes, t.pendientes ?? [])
      acc.repetidas.push(...(t.repetidas ?? []))
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
    setSinAplicar([]); setRepetidasAplicadas(rep)   // las cifras ya incluyen lo elegido
    setResultado(acc); setPaso('validar')
  }

  /** Guarda una decisión. No revalida sola: son N consultas y la conexión es la que es. */
  function decidir(clave: string, valor: string) {
    const r = aResolucion(valor)
    setSinAplicar(prev => prev.includes(clave) ? prev : [...prev, clave])
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
    let claves: ClavesVistas = []
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
  /** Los que no preguntan nada: se crean solos. Son consecuencia, no decisión. */
  const deOficio = resultado?.pendientes.filter(p => !p.decidir) ?? []
  // Lo elegido en pantalla que todavía no ha viajado al servidor: mientras haya
  // algo, las cifras de arriba no lo incluyen y el botón final lo dice.
  const repetidasSinAplicar    = repetidas !== repetidasAplicadas
  const hayDecisionesSinAplicar = sinAplicar.length > 0 || repetidasSinAplicar

  function descargarErrores() {
    descargarCsv(`errores-${loteId}.csv`,
      'fila,motivo\n' + malas.map(e => `${e.fila},${celdaCsv(e.motivo ?? '')}`).join('\n') + '\n')
  }

  function reiniciar() {
    setPaso('entidad'); setEntidad(''); setCampos([]); setDefs([]); setLoteId(''); setCabeceras([]); setTotal(0)
    setColumnas({}); setGlobales({}); setResultado(null); setResumen(null); setPolitica('SALTAR')
    setSinAplicar([]); setRepetidas('DECIDIR'); setRepetidasAplicadas('DECIDIR')
    setPlantillas([]); setNombrePlantilla(''); setDeshecho(null); setAvisos([]); setProgreso(null)
    setResoluciones({}); setAuxiliares([])
  }

  const etiquetaProgreso = progreso ? `${progreso.hechas} de ${progreso.total}` : ''
  /** Cómo llamar a lo que se está importando al hablarle al dueño: «cobros», no «filas». */
  const etiquetaEntidad = ENTIDADES.find(e => e.id === entidad)?.etiqueta ?? 'filas'

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

      {/* ── Paso 4: revisar (dry-run) ──
          Una TARJETA por asunto, y el corte no es por tema sino por naturaleza:
          lo que me PREGUNTA algo va en su tarjeta con sus botones dentro, lo que
          me INFORMA va en las suyas. Todo esto vivía en una sola tarjeta y el
          resultado era que el botón de aplicar quedaba flotando entre dos bloques
          y parecía de otro: una acción sin contenedor propio se pega a lo que
          tenga más cerca. */}
      {paso === 'validar' && resultado && (
        <div className="imprt-revisar">
          <div className="card">
            <div className="imprt-tiles">
              <div className="imprt-tile"><strong>{resultado.total}</strong><span>Filas</span></div>
              <div className="imprt-tile"><strong>{resultado.ok}</strong><span>Listas para importar</span></div>
              {resultado.por_decidir > 0 && (
                <div className="imprt-tile"><strong>{resultado.por_decidir}</strong><span>Esperan que decidas</span></div>
              )}
              <div className="imprt-tile"><strong>{resultado.errores}</strong><span>Con error</span></div>
            </div>
          </div>

          {/* Nombres que el archivo trae y no cuadran con nada. Se pregunta en vez
              de emparejar por parecido: clasificar un gasto en la categoría
              equivocada mete dinero en el renglón que no toca del informe. Por
              encima del tope, vincular una a una deja de ahorrar tiempo frente a
              corregir el archivo de origen: se retira el panel interactivo y se
              enseña un resumen agrupado, igual que la tabla de errores. */}
          {urgentes.length > TOPE_COTEJO ? (
            <div className="card">
              <div className="card-header">
                <h2 className="card-title card-title-sm">Nombres que no acabamos de reconocer</h2>
                <span className="text-xs-muted">{urgentes.length} nombres</span>
              </div>
              <div className="alert alert-warning alert-intro">
                <AlertTriangle size={16} strokeWidth={2} />
                Son demasiados para vincularlos aquí uno a uno. Corrige el archivo de origen (o
                divídelo en partes más pequeñas) y vuelve a subirlo.
              </div>
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
          ) : urgentes.length > 0 && (
            <PanelPendientes
              pendientes={urgentes}
              resoluciones={resoluciones}
              sinAplicar={sinAplicar}
              onDecidir={decidir}
            />
          )}

          {/* Filas que dicen lo mismo que otra del archivo. No es un error y no se
              adivina: se enfrentan las dos y se pregunta, porque solo el dueño sabe
              si son dos cobros de verdad o uno escrito dos veces. */}
          {resultado.repetidas.length > 0 && (
            <PanelRepetidas
              repetidas={resultado.repetidas}
              decision={repetidas}
              sinAplicar={repetidasSinAplicar}
              onDecidir={setRepetidas}
            />
          )}

          {/* Totales de lo que se va a escribir: un decimal mal leído se ve aquí. */}
          {resultado.resumen.length > 0 && (
            <div className="card">
              <div className="card-header">
                <h2 className="card-title card-title-sm">Totales</h2>
                <span className="text-xs-muted">Comprueba que son los que esperas</span>
              </div>
              <div className="imprt-tiles">
                {resultado.resumen.map(t => (
                  <div key={t.etiqueta} className="imprt-tile">
                    {/* Las cuentas de filas van sin decimales: «3 filas», no «3,00». */}
                    <strong>{t.entero ? t.valor : formatearImporte(t.valor)}</strong>
                    <span>{t.etiqueta}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {resultado.errores > 0 && (
            <div className="card">
              <div className="card-header">
                <h2 className="card-title card-title-sm">Filas con problemas</h2>
                <button type="button" className="btn btn-secondary btn-sm" onClick={descargarErrores}>
                  <Download size={14} strokeWidth={2} /> Descargar errores
                </button>
              </div>
              <div className="alert alert-warning alert-intro">
                <AlertTriangle size={16} strokeWidth={2} /> Se importarán solo las correctas; corrige
                estas {resultado.errores} y vuelve a subirlas.
              </div>
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
          )}

          {/* Qué va a pasar, dicho con las palabras del dueño y no con las del
              importador: «se crearán 383 cobros» se entiende, «383 filas OK» no.
              Aquí caen también los nombres que se dan de alta solos: no preguntan
              nada, son una CONSECUENCIA, y estaban en la tarjeta de decisiones
              mezclados con lo que sí espera respuesta. */}
          <div className="card">
            <div className="card-header">
              <h2 className="card-title card-title-sm">Qué va a pasar al importar</h2>
            </div>
            <ul className="imprt-plan">
              {resultado.ok > 0 && (
                <li>
                  <Check size={14} strokeWidth={2.5} />
                  <span>Se {politica === 'ACTUALIZAR' ? 'crearán o actualizarán' : 'crearán'} <strong>{resultado.ok} {etiquetaEntidad.toLowerCase()}</strong>.</span>
                </li>
              )}
              {deOficio.length > 0 && (
                <li>
                  <Check size={14} strokeWidth={2.5} />
                  <span>
                    Se {deOficio.length === 1 ? 'creará' : 'crearán'} <strong>{deOficio.length} {deOficio.length === 1 ? 'ficha nueva' : 'fichas nuevas'}</strong>
                    {' '}que el archivo nombra y todavía no tienes.
                  </span>
                </li>
              )}
              {resultado.por_decidir > 0 && (
                <li>
                  <AlertTriangle size={14} strokeWidth={2} />
                  <span><strong>{resultado.por_decidir} filas</strong> esperan que decidas ahí arriba. Si las dejas así, no se importan.</span>
                </li>
              )}
              {resultado.errores > 0 && (
                <li>
                  <AlertTriangle size={14} strokeWidth={2} />
                  <span><strong>{resultado.errores} filas</strong> se quedan fuera por errores del archivo.</span>
                </li>
              )}
              {politica === 'SALTAR' && (
                <li>
                  <Check size={14} strokeWidth={2.5} />
                  <span>Lo que ya exista en CLAUX <strong>no se toca</strong>.</span>
                </li>
              )}
            </ul>

            {deOficio.length > 0 && (
              <details className="imprt-pend-mas">
                <summary>Ver las {deOficio.length} fichas que se crearán</summary>
                <p className="input-hint">
                  No se parecen a nada de lo que ya tienes. Si alguna era en realidad una de las
                  que ya existen, cámbiala aquí.
                </p>
                <div className="imprt-pend-lista">
                  {deOficio.map(p => (
                    <FilaPendiente key={p.clave} p={p}
                      resolucion={resoluciones[p.clave]}
                      sinAplicar={sinAplicar.includes(p.clave)}
                      onDecidir={decidir} />
                  ))}
                </div>
              </details>
            )}

            <p className="imprt-plan-cuando">
              Nada de esto se ha escrito todavía. Se escribe cuando pulses «Importar», y podrás
              deshacerlo entero desde el paso siguiente.
            </p>

            {/* Un solo botón principal en todo el paso, y su etiqueta dice lo que
                hará AHORA. Elegir es gratis; recalcular cuesta N consultas contra
                una conexión mala, así que se paga una vez y en un único sitio —en
                vez de un «aplicar» por tarjeta que además parecía una confirmación
                de algo que ya se veía escrito. */}
            <div className="imprt-acciones">
              <button type="button" className="btn btn-ghost" onClick={() => setPaso('mapear')}>
                <ArrowLeft size={15} strokeWidth={2} /> Atrás
              </button>
              {hayDecisionesSinAplicar ? (
                <button type="button" className="btn btn-primary" onClick={() => validar()} disabled={cargando}>
                  {cargando
                    ? <><span className="spinner spinner-sm" /> Comprobando {etiquetaProgreso}…</>
                    : <>Recalcular con tus decisiones <ArrowRight size={15} strokeWidth={2} /></>}
                </button>
              ) : (
                <button type="button" className="btn btn-primary" onClick={aplicar} disabled={cargando || resultado.ok === 0}>
                  {cargando
                    ? <><span className="spinner spinner-sm" /> Importando {etiquetaProgreso}…</>
                    : <>Importar {resultado.ok} filas</>}
                </button>
              )}
            </div>
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
