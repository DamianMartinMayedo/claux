'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
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
  plantillaImport, crearMigracionLiangApp, ajustarMigracionLiangApp,
  deshacerMigracionLiangApp, plantillaFacturasLiangApp, estadoLoteImport,
} from '@/app/actions/portal/importar'
import {
  AyudaLiangApp, CuadreLiangApp, FacturasLiangApp, FichasLiangApp, GruposLiangApp,
  AplicadosLiangApp, EstadoLiangApp, conEstado, cuadraTodo, type MigracionEstado,
} from './_MigracionLiangApp'

// MIME del .xlsx. Se escribe aquí y no se importa de `@/lib/exportar/excel` a
// propósito: ese módulo arrastra el escritor de Excel (server-only) y no debe
// entrar en el bundle del cliente.
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

type Campo    = { campo: string; etiqueta: string; obligatorio: boolean; ayuda?: string; alias?: string[]; ejemplo?: string }
type Default  = { campo: string; etiqueta: string; obligatorio: boolean; ayuda?: string; valor?: string; tipo?: 'texto' | 'fecha'; opciones?: { valor: string; etiqueta: string }[] }
type Paso     = 'entidad' | 'subir' | 'mapear' | 'validar' | 'hecho'
/** Un lote de la migración ya aplicado. Va por `lote_id` y no por etiqueta:
 *  al retomar un proceso cortado hay que saber si ESE lote ya está apuntado. */
type Aplicado = { lote_id: string; etiqueta: string; insertadas: number }
type Politica = 'SALTAR' | 'ACTUALIZAR' | 'CREAR'
type FilaMala = { fila: number; ok: boolean; motivo?: string; decidir?: boolean }
type Total    = { etiqueta: string; valor: number; entero?: boolean }
/** Lo que devuelve validar el lote: lo que se enseña en el paso de revisar. */
type Resultado = {
  total: number; ok: number; errores: number; por_decidir: number
  nuevos: number; actualizar: number; saltar: number
  filas: FilaMala[]; resumen: Total[]; pendientes: Pendiente[]; repetidas: FilaRepetida[]
}
type Resumen  = { insertadas: number; actualizadas: number; saltadas: number; errores: number }
type Deshecho = { deshechas: number; intactas: number; motivos: { fila: number; motivo: string }[] }

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
  { id: 'facturas',        etiqueta: 'Facturas de venta',      desc: 'Histórico de ventas facturadas, con su número y su cliente. Lo pendiente va a CxC.', disponible: true, destino: '/portal/ventas' },
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
  opciones, elegida, etiquetaTipo, cargando, onElegir,
}: {
  opciones:     { valor: string; etiqueta: string }[]
  elegida:      { valor: string; etiqueta: string } | undefined
  etiquetaTipo: string
  cargando:     boolean
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
        disabled={cargando}
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
  p, resolucion, sinAplicar, cargando, onDecidir,
}: {
  p:           Pendiente
  resolucion:  Resolucion | undefined
  sinAplicar:  boolean
  cargando:    boolean
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
          cargando={cargando}
          onElegir={v => onDecidir(p.clave, `USAR|${v}`)}
        />
      )}

      <div className="imprt-pend-botones">
        {p.creable  && (
          <button type="button" className={`btn btn-sm ${activa('CREAR')}`} disabled={cargando}
            onClick={() => onDecidir(p.clave, 'CREAR')}>Crear ficha nueva</button>
        )}
        {p.omitible && (
          <button type="button" className={`btn btn-sm ${activa('OMITIR')}`} disabled={cargando}
            onClick={() => onDecidir(p.clave, 'OMITIR')}>Dejarlo en blanco</button>
        )}
        <button type="button" className={`btn btn-sm ${activa('RECHAZAR')}`} disabled={cargando}
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
  pendientes, resoluciones, sinAplicar, cargando, onDecidir,
}: {
  pendientes:   Pendiente[]
  resoluciones: Record<string, Resolucion>
  sinAplicar:   string[]
  cargando:     boolean
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
            cargando={cargando}
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
  repetidas, decision, sinAplicar, cargando, onDecidir,
}: {
  repetidas:  FilaRepetida[]
  decision:   DecisionRepetidas
  sinAplicar: boolean
  cargando:   boolean
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
        <button type="button" disabled={cargando}
          className={`btn btn-sm ${decision === 'DISTINTAS' ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => onDecidir('DISTINTAS')}>
          Son distintas: impórtalas
        </button>
        <button type="button" disabled={cargando}
          className={`btn btn-sm ${decision === 'FUERA' ? 'btn-primary' : 'btn-secondary'}`}
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

/**
 * El asistente a medias, guardado en la pestaña.
 *
 * Salir a mirar otra pantalla —una empresa, una moneda, el saldo de una caja— y
 * volver desmonta el componente y se lleva por delante el estado: el operador
 * volvía al paso 1 con el archivo subido, mapeado y medio revisado. Ahora el
 * asistente se restaura donde estaba.
 *
 * `sessionStorage` y no `localStorage` a propósito: una importación a medias
 * pertenece a esta pestaña y a este rato, no debe resucitar tres días después.
 * Los archivos van en su PROPIA clave porque pesan (base64) y no tienen por qué
 * reescribirse cada vez que se teclea en un campo.
 */
/** Lo que se le dice al operador cuando el guardado se quedó sin los archivos. */
const AVISO_SIN_ARCHIVOS =
  'Los archivos ya no están guardados en esta pestaña. Lo subido sigue en pie y puedes continuar, '
  + 'pero para cambiar los archivos hay que empezar la migración otra vez.'

const LLAVE          = 'claux:importar:v2'
const LLAVE_ARCHIVOS = 'claux:importar:v2:archivos'

/**
 * Lee lo guardado en la pestaña. No lanza nunca: un guardado ilegible —de otra
 * versión, o escrito a medias— es lo mismo que no tener guardado.
 */
function leerGuardado(): { g: Guardado | null; archivos: { nombre: string; base64: string }[] } {
  try {
    const crudo = sessionStorage.getItem(LLAVE)
    const g     = crudo ? JSON.parse(crudo) as Guardado : null
    // El paso 1 no es un sitio al que volver: ahí no hay nada empezado.
    if (!g?.paso || g.paso === 'entidad') return { g: null, archivos: [] }
    const arch = sessionStorage.getItem(LLAVE_ARCHIVOS)
    return { g, archivos: arch ? JSON.parse(arch) : [] }
  } catch {
    olvidarGuardado()
    return { g: null, archivos: [] }
  }
}

function olvidarGuardado() {
  try { sessionStorage.removeItem(LLAVE); sessionStorage.removeItem(LLAVE_ARCHIVOS) } catch { /* nada */ }
}

type Guardado = {
  paso: Paso
  entidad: string; etiquetaEnt: string; destino: string
  campos: Campo[]; defs: Default[]
  encoding: string; loteId: string; cabeceras: string[]; total: number; avisos: string[]
  columnas: Record<string, string>; globales: Record<string, string>; politica: Politica
  resultado: Resultado | null; resoluciones: Record<string, Resolucion>; sinAplicar: string[]
  repetidas: DecisionRepetidas; repetidasAplicadas: DecisionRepetidas
  resumen: Resumen | null; auxiliares: { etiqueta: string; cantidad: number }[]
  plantillas: { plantilla_id: string; nombre: string }[]; nombrePlantilla: string
  deshecho: Deshecho | null
  mig: MigracionEstado | null; excluidas: number[]; elegido: Record<string, string>
  cola: MigracionEstado['lotes']; migAplicados: Aplicado[]
  /** Había un proceso EN MARCHA al guardar. Al volver no se cree la foto: pregunta. */
  enCurso: boolean
  interrumpido: string
}

export default function ImportarWizard({ entidadesPermitidas }: { entidadesPermitidas?: string[] }) {
  const [paso, setPaso]         = useState<Paso>('entidad')
  const [cargando, setCargando] = useState(false)
  const [progreso, setProgreso] = useState<{ hechas: number; total: number } | null>(null)

  // ── Migración desde LiangApp ──
  // Los cinco pasos son los mismos (plan, D6). `mig` es lo único que decide si
  // el asistente está en una migración o en una importación de toda la vida.
  const [mig, setMig]             = useState<MigracionEstado | null>(null)
  // Los archivos ya leídos se guardan aquí: añadir el estado que faltaba o
  // quitar el que sobraba no puede obligar a volver a elegirlos todos.
  const [archivos, setArchivos]   = useState<{ nombre: string; base64: string }[]>([])
  const [excluidas, setExcluidas] = useState<number[]>([])
  const [elegido, setElegido]     = useState<Record<string, string>>({})
  const [cola, setCola]           = useState<MigracionEstado['lotes']>([])
  const [migAplicados, setMigAplicados] = useState<Aplicado[]>([])
  const [bajandoFacturas, setBajandoFacturas] = useState(false)
  // El estado de rendimiento es el primer tramo de la subida: mientras no esté,
  // no se acepta ningún mayor.
  const fichaEstado = mig?.fichas.find(f => f.tipo === 'estado') ?? null

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
  // Lo que se está haciendo con los archivos, para que el recuadro de subida diga
  // lo mismo que el aviso: leer y quitar no son la misma cosa.
  const [avisoCarga, setAvisoCarga] = useState('Leyendo los archivos…')
  const [bajandoPlantilla, setBajandoPlantilla] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  // El selector de «cambiar el estado»: va aparte del de subir porque sustituye
  // en vez de añadir.
  const estadoRef = useRef<HTMLInputElement>(null)

  const [columnas, setColumnas]   = useState<Record<string, string>>({})
  const [globales, setGlobales]   = useState<Record<string, string>>({})
  const [politica, setPolitica]   = useState<Politica>('SALTAR')

  const [resultado, setResultado] = useState<Resultado | null>(null)
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
  const [resumen, setResumen]     = useState<Resumen | null>(null)
  // Lo que el lote creó DE PASO (proveedores, categorías, clientes o servicios
  // que una fila nombraba y no existían): solo llega en la última tanda.
  const [auxiliares, setAuxiliares] = useState<{ etiqueta: string; cantidad: number }[]>([])

  const [plantillas, setPlantillas] = useState<{ plantilla_id: string; nombre: string }[]>([])
  const [nombrePlantilla, setNombrePlantilla] = useState('')
  const [confirmarDeshacer, setConfirmarDeshacer] = useState(false)
  const [deshecho, setDeshecho]   = useState<Deshecho | null>(null)

  // ── Guardado del asistente en la pestaña (ver LLAVE, arriba) ──
  // `listo` marca que ya se intentó restaurar: hasta entonces no se guarda nada,
  // porque el primer render tiene el estado vacío y borraría lo guardado.
  const [listo, setListo] = useState(false)
  const empezarAGuardar = () => setListo(true)
  // Qué pasó con el proceso que se quedó a medias cuando el operador salió. Es
  // lo único que se le puede decir con certeza: sale de preguntarle al servidor.
  const [interrumpido, setInterrumpido] = useState('')

  /** Vuelca en el asistente lo que había guardado. */
  function restaurar(g: Guardado, arch: { nombre: string; base64: string }[]) {
    setPaso(g.paso)
    setEntidad(g.entidad); setEtiqueta(g.etiquetaEnt); setDestino(g.destino)
    setCampos(g.campos); setDefs(g.defs)
    setEncoding(g.encoding); setLoteId(g.loteId); setCabeceras(g.cabeceras)
    setTotal(g.total); setAvisos(g.avisos)
    setColumnas(g.columnas); setGlobales(g.globales); setPolitica(g.politica)
    setResultado(g.resultado); setResoluciones(g.resoluciones); setSinAplicar(g.sinAplicar)
    setRepetidas(g.repetidas); setRepetidasAplicadas(g.repetidasAplicadas)
    setResumen(g.resumen); setAuxiliares(g.auxiliares)
    setPlantillas(g.plantillas); setNombrePlantilla(g.nombrePlantilla)
    setDeshecho(g.deshecho)
    setMig(g.mig); setExcluidas(g.excluidas); setElegido(g.elegido)
    setCola(g.cola); setMigAplicados(g.migAplicados)
    setArchivos(arch)
    setInterrumpido(g.interrumpido ?? '')
  }

  /**
   * Volver a mitad de un proceso. Lo guardado es de ANTES de que el servidor
   * terminara —o de que fallara—, así que el asistente no se lo cree: pregunta
   * cómo quedó el lote de verdad y se coloca donde toca. Mientras pregunta,
   * `cargando` mantiene todo bloqueado; eso es lo que impide volver a pulsar
   * «Continuar» sobre algo que ya estaba corriendo.
   */
  async function retomar(g: Guardado) {
    if (!g.loteId) {
      setInterrumpido('El proceso se cortó al salir de la pantalla, antes de escribir nada. Vuelve a empezarlo.')
      return
    }
    setCargando(true)
    try {
      const res = await estadoLoteImport(g.loteId)
      setCargando(false)
      const cuenta = res.resumen
      if (!res.ok || !cuenta) {
        setInterrumpido(res.error ?? 'No se ha podido comprobar cómo quedó el proceso que se cortó.')
        return
      }
      // Terminó sin nosotros: el resultado es el de la traza, no el de la pantalla.
      if (res.estado === 'APLICADO') {
        setResumen(cuenta); setAuxiliares(res.auxiliares ?? [])
        // Sin duplicar: el corte pudo pillarnos ya con el lote apuntado (p. ej. al
        // abrir el siguiente, cuando `loteId` todavía es el de antes).
        if (g.mig) setMigAplicados(prev => prev.some(a => a.lote_id === g.loteId)
          ? prev
          : [...prev, { lote_id: g.loteId, etiqueta: g.etiquetaEnt, insertadas: cuenta.insertadas }])
        setPaso('hecho')
        setInterrumpido('La importación terminó en el servidor mientras estabas fuera. Esto es lo que quedó.')
        return
      }
      // Se deshizo sin nosotros: la traza puede seguir ahí, así que sin esta rama
      // se leería como una importación a medias y se invitaría a repetirla.
      if (res.estado === 'REVERTIDO') {
        setInterrumpido('Lo importado se deshizo mientras estabas fuera. Revisa cómo quedó antes de repetir nada.')
        return
      }
      // A medias: lo escrito está escrito y no se repite (el motor salta las filas
      // que ya tienen traza), así que lo honrado es decir por dónde iba.
      if ((res.escritas ?? 0) > 0) {
        setInterrumpido(`La importación se cortó a medias: va por la línea ${res.escritas} de ${g.total}. `
          + 'Vuelve a pulsar «Importar» y sigue desde ahí, sin repetir ninguna.')
        return
      }
      setInterrumpido('La comprobación se cortó al salir de la pantalla y no se escribió nada. Vuelve a pulsar el botón.')
    } catch {
      setInterrumpido('No se ha podido comprobar cómo quedó el proceso que se cortó. Revisa lo importado antes de repetirlo.')
    } finally {
      setCargando(false)
    }
  }

  // Restaurar tras montar: el guardado es un sistema externo (la pestaña) y solo
  // existe en el cliente, así que el primer render tiene que ser idéntico al del
  // servidor —si no, hay hydration mismatch— y esto va después.
  useEffect(() => {
    const { g, archivos: arch } = leerGuardado()
    // Volcar un sistema externo una sola vez, al montar: leerlo en el render
    // rompería la hidratación. Si había algo en marcha, no se restaura y ya —se
    // le pregunta al servidor cómo quedó (`retomar`).
    if (g) { restaurar(g, arch); if (g.enCurso) void retomar(g) }
    empezarAGuardar()
  }, [])

  useEffect(() => {
    if (!listo) return
    if (paso === 'entidad') { olvidarGuardado(); return }
    const g: Guardado = {
      paso, entidad, etiquetaEnt, destino, campos, defs, encoding, loteId, cabeceras, total,
      avisos, columnas, globales, politica, resultado, resoluciones, sinAplicar, repetidas,
      repetidasAplicadas, resumen, auxiliares, plantillas, nombrePlantilla, deshecho,
      mig, excluidas, elegido, cola, migAplicados,
      enCurso: cargando, interrumpido,
    }
    try {
      sessionStorage.setItem(LLAVE, JSON.stringify(g))
    } catch {
      // No cabe. Se reintenta sin el detalle de las filas malas, que es lo que
      // engorda de un archivo grande: perder esa lista es mucho menos grave que
      // perder el sitio donde estaba el operador.
      try {
        const ligero = { ...g, resultado: g.resultado && { ...g.resultado, filas: [] } }
        sessionStorage.setItem(LLAVE, JSON.stringify(ligero))
      } catch {
        // Ni así: se sigue sin guardado, que no puede tumbar la importación.
      }
    }
  }, [listo, paso, entidad, etiquetaEnt, destino, campos, defs, encoding, loteId, cabeceras,
      total, avisos, columnas, globales, politica, resultado, resoluciones, sinAplicar, repetidas,
      repetidasAplicadas, resumen, auxiliares, plantillas, nombrePlantilla, deshecho, mig,
      excluidas, elegido, cola, migAplicados, cargando, interrumpido])

  // Los archivos, en su propia clave: pesan y solo cambian al subir o quitar uno.
  useEffect(() => {
    if (!listo) return
    try {
      if (!archivos.length) sessionStorage.removeItem(LLAVE_ARCHIVOS)
      else sessionStorage.setItem(LLAVE_ARCHIVOS, JSON.stringify(archivos))
    } catch {
      // No caben (el tope de la pestaña ronda los 5 MB): se descartan enteros en
      // vez de dejar la mitad. De que no se toque el conjunto a ciegas se encarga
      // `sinArchivos`.
      sessionStorage.removeItem(LLAVE_ARCHIVOS)
    }
  }, [listo, archivos])

  /**
   * El reconocimiento sigue en pie pero los archivos no se pudieron guardar al
   * salir de la pantalla. Los lotes están en la base y se puede continuar, pero
   * añadir o quitar releería SOLO lo que se suelte ahora —el motor relee siempre
   * el conjunto entero—, así que se cierra esa puerta en vez de perder lo subido.
   */
  const sinArchivos = !!mig && mig.fichas.length > 0 && archivos.length === 0

  const idxPaso = PASOS.findIndex(p => p.id === paso)
  const entidadesVisibles = entidadesPermitidas
    ? ENTIDADES.filter(e => entidadesPermitidas.includes(e.id))
    : ENTIDADES

  /**
   * Volver a un paso ya recorrido. Solo hacia atrás y solo si ese paso todavía
   * se sostiene: sin archivo no hay nada que mapear, y una vez APLICADO el lote
   * no se vuelve — «Revisar» ofrecería importar algo que ya está importado.
   */
  function puedeVolver(destino: Paso, i: number): boolean {
    if (i >= idxPaso || paso === 'hecho') return false
    // Aplicada ya una parte de la migración, los pasos que releen los archivos se
    // cierran: el servidor se niega igual, y ofrecerlos es mandar contra un muro.
    if (mig && migAplicados.length > 0 && (destino === 'subir' || destino === 'mapear')) return false
    return destino === 'entidad' ? true
      : destino === 'subir'      ? (!!entidad || !!mig)
      : destino === 'mapear'     ? (!!loteId || !!mig)
      : !!resultado
  }

  // ── Migración: la puerta, el reconocimiento y el fan-out ────────────────────

  /** Los presets de una entidad (los que no se preguntan: ya traen respuesta). */
  function valoresDe(ds: Default[]): Record<string, string> {
    return Object.fromEntries(ds.map(d => [
      d.campo, d.valor ?? (d.opciones?.length === 1 ? d.opciones[0].valor : ''),
    ]))
  }

  function empezarMigracion() {
    reiniciar()
    setMig({
      migracion_id: '', empresa: '', periodo: '', fichas: [], cuadre: [],
      utilidad: { reconstruida: 0, oficial: null, cuadra: false, completa: false },
      sinArchivo: [], facturas: [], grupos: [], avisos: [], errores: [], lotes: [],
    })
    setEtiqueta('LiangApp')
    setPaso('subir')
  }

  /**
   * Lee los archivos elegidos junto a `previos` —los que ya estaban—, que es lo
   * que permite corregir o completar sin repetir la subida entera.
   */
  async function sumarArchivos(files: File[], previos: typeof archivos, exigeEstado = false) {
    if (files.some(f => /\.xls$/i.test(f.name))) {
      toastError('El .xls antiguo no se puede leer. Ábrelo en Excel y guárdalo como .xlsx.')
      return
    }
    const nuevos = await Promise.all(files.map(async f => ({
      nombre: f.name, base64: aBase64(await f.arrayBuffer()),
    })))
    // Un archivo con el mismo nombre SUSTITUYE al de antes: es cómo se corrige
    // el que se subió mal, sin tener que empezar de cero.
    const nombres = new Set(nuevos.map(a => a.nombre))
    await leerMigracion([...previos.filter(a => !nombres.has(a.nombre)), ...nuevos], { exigeEstado })
  }

  /** Quita un archivo del conjunto y vuelve a leer lo que queda. */
  async function quitarArchivo(nombre: string) {
    const quedan = archivos.filter(a => a.nombre !== nombre)
    // Sin archivos no hay nada que leer, pero la migración se conserva vacía: su
    // id es lo que borra los borradores anteriores en la próxima subida.
    if (!quedan.length) {
      setArchivos([]); setExcluidas([]); setElegido({})
      setMig(m => m && { ...m, fichas: [], cuadre: [], grupos: [], lotes: [], facturas: [], sinArchivo: [], avisos: [], errores: [] })
      setPaso('subir')
      return
    }
    // Releer NO es avanzar: quitar un archivo desde el paso de subir no puede
    // empujar al operador al reconocimiento, que es justo de donde venía.
    await leerMigracion(quedan, { avanzar: false, aviso: 'Quitando el archivo…' })
  }

  /**
   * Lee el conjunto entero y abre el reconocimiento. Los lotes de la lectura
   * anterior se borran en el servidor (`reemplaza`) para que no queden
   * borradores sueltos de cada intento.
   *
   * `exigeEstado` es el primer tramo de la subida: hasta que no entra el estado
   * de rendimiento no se acepta nada más. Sin él la migración no se puede
   * aplicar, así que pedirlo el último es hacer trabajar en balde.
   */
  async function leerMigracion(
    todos: { nombre: string; base64: string }[],
    op: { exigeEstado?: boolean; avanzar?: boolean; aviso?: string } = {},
  ) {
    const { exigeEstado = false, avanzar = true, aviso = 'Leyendo los archivos…' } = op
    setCargando(true); setInterrumpido(''); setAvisoCarga(aviso)
    const ld = toastLoading(aviso)
    try {
      const res = await crearMigracionLiangApp(todos, mig?.migracion_id || undefined, exigeEstado)
      // Los valores del lote (empresa, moneda) se piden UNA vez para toda la
      // migración: es una contabilidad, no dos archivos que se parecen.
      const ds: Default[] = []
      for (const l of res.lotes ?? []) {
        const c = await obtenerCamposEntidad(l.entidad)
        for (const d of (c.defaults ?? []) as Default[]) if (!ds.some(x => x.campo === d.campo)) ds.push(d)
      }
      await ld.dismiss()
      setCargando(false)
      const fichas = res.fichas ?? []
      // Una lectura que ni siquiera llegó a mirar los archivos —tope de tamaño,
      // migración ya aplicada, sin permiso— NO puede llevarse por delante lo que
      // había: se dice qué ha pasado y todo se queda como estaba. Va la primera
      // porque el motivo real es este, no el del tramo. Un archivo que sí se leyó
      // siempre trae ficha, aunque sea para decir que no se reconoce.
      if (!fichas.length) { toastError(res.error ?? 'No se pudo leer la migración.'); return }
      // Primer tramo: si lo que han soltado no es el estado, no entra. Se dice qué
      // es lo que han subido, que es más útil que «archivo no válido».
      if (exigeEstado && !fichas.some(f => f.tipo === 'estado')) {
        toastError(fichaEstado
          // Se estaba SUSTITUYENDO el que había: no se ha tocado nada.
          ? 'Ese archivo no es un Estado de rendimiento financiero. El que había sigue en su sitio.'
          : fichas.some(f => f.tipo === 'mayor')
            ? 'Eso es un libro mayor. Empieza por el Estado de rendimiento financiero.'
            : 'Ese archivo no es el Estado de rendimiento financiero de LiangApp.')
        return
      }
      setArchivos(todos)
      setMig({
        // Si la lectura no ha llegado a crear lotes, la anterior sigue viva en la
        // base: se conserva su id para poder borrarla en el próximo intento.
        migracion_id: res.migracion_id ?? mig?.migracion_id ?? '',
        empresa: res.empresa ?? '', periodo: res.periodo ?? '',
        fichas: res.fichas ?? [], cuadre: res.cuadre ?? [],
        utilidad: res.utilidad ?? { reconstruida: 0, oficial: null, cuadra: false, completa: false },
        sinArchivo: res.sinArchivo ?? [], facturas: res.facturas ?? [], grupos: res.grupos ?? [],
        avisos: res.avisos ?? [], errores: res.errores ?? (res.error ? [res.error] : []),
        lotes: res.lotes ?? [],
      })
      setExcluidas([]); setElegido({}); setCola([]); setMigAplicados([])
      setDefs(ds); setGlobales(valoresDe(ds))
      // Con el estado dentro pero sin ningún mayor todavía, el sitio sigue siendo
      // el paso de subir: no hay nada que reconocer.
      if (avanzar && fichas.some(f => f.tipo === 'mayor')) setPaso('mapear')
    } catch {
      toastError('No se ha podido leer los archivos. Vuelve a intentarlo.')
    } finally {
      await ld.dismiss()
      setCargando(false)
    }
  }

  /** Guarda lo decidido y abre el primer lote en el paso de revisar. */
  async function continuarMigracion() {
    if (!mig) return
    setCargando(true)
    const ld = toastLoading('Guardando…')
    try {
      const res = await ajustarMigracionLiangApp(mig.migracion_id, { grupos: elegido, excluidas })
      await ld.dismiss()
      if (!res.ok || !res.lotes) { setCargando(false); toastError(res.error ?? 'No se pudo guardar.'); return }
      if (res.grupos) setMig({ ...mig, grupos: res.grupos })
      const vivos = mig.lotes
        .map(l => ({ ...l, filas: res.lotes?.find(x => x.lote_id === l.lote_id)?.filas ?? 0 }))
        .filter(l => l.filas > 0)
      if (!vivos.length) { setCargando(false); toastError('No queda ninguna línea por importar.'); return }
      setCola(vivos.slice(1))
      await abrirLote(vivos[0])
    } catch {
      toastError('No se ha podido guardar el reconocimiento. Vuelve a intentarlo.')
    } finally {
      await ld.dismiss()
      setCargando(false)
    }
  }

  /**
   * Pone un lote de la migración en el asistente y lo valida. Los valores del
   * paso anterior mandan sobre los presets de la entidad: la empresa y la moneda
   * son de la migración entera, no de cada lote.
   */
  async function abrirLote(lote: MigracionEstado['lotes'][number]) {
    setCargando(true)
    try {
      const res = await obtenerCamposEntidad(lote.entidad)
      if (!res.ok || !res.campos) { setCargando(false); toastError(res.error ?? 'Error inesperado.'); return }
      const ds = (res.defaults ?? []) as Default[]
      const gl = { ...valoresDe(ds), ...globales }
      const en = ENTIDADES.find(e => e.id === lote.entidad)
      setEntidad(lote.entidad); setEtiqueta(res.etiqueta ?? lote.etiqueta); setDestino(en?.destino ?? '')
      setCampos(res.campos as Campo[]); setDefs(ds); setGlobales(gl)
      setLoteId(lote.lote_id); setTotal(lote.filas); setColumnas(lote.columnas); setCabeceras([])
      setPolitica('CREAR'); setRepetidas('DISTINTAS')
      setResultado(null); setResoluciones({}); setSinAplicar([]); setResumen(null); setDeshecho(null)
      setCargando(false)
      // Un histórico es histórico: cada línea es un hecho distinto aunque dos digan
      // lo mismo, y el cliente está vacío, así que no hay nada con lo que chocar.
      await validar({}, 'DISTINTAS', 'CREAR', { loteId: lote.lote_id, columnas: lote.columnas, total: lote.filas, defs: ds, globales: gl })
    } catch {
      toastError('No se ha podido abrir el lote. Vuelve a intentarlo.')
    } finally {
      setCargando(false)
    }
  }

  async function descargarFacturas() {
    if (!mig || bajandoFacturas) return
    setBajandoFacturas(true)
    const ld = toastLoading('Generando…')
    try {
      const res = await plantillaFacturasLiangApp(mig.migracion_id)
      await ld.dismiss()
      setBajandoFacturas(false)
      if (!res.ok || !res.base64) { toastError(res.error ?? 'No se pudo generar la plantilla.'); return }
      for (const a of res.avisos ?? []) toastError(a)
      descargarBase64(res.nombre ?? 'facturas.xlsx', res.base64, XLSX_MIME)
    } catch {
      toastError('No se ha podido generar la plantilla. Vuelve a intentarlo.')
    } finally {
      await ld.dismiss()
      setBajandoFacturas(false)
    }
  }

  async function elegirEntidad(en: typeof ENTIDADES[number]) {
    setCargando(true)
    const ld = toastLoading('Cargando…')
    try {
      const res = await obtenerCamposEntidad(en.id)
      await ld.dismiss()
      setCargando(false)
      if (!res.ok || !res.campos) { toastError(res.error ?? 'Error inesperado.'); return }
      // El archivo pertenece a la entidad con la que se subió: al elegir entidad se
      // suelta, o se acabaría mapeando las columnas de un archivo a los campos de otra.
      setLoteId(''); setCabeceras([]); setTotal(0); setColumnas({}); setAvisos([]); setResultado(null)
      setResoluciones({})
      // Y si venía de una migración, se suelta: `mig` es lo único que decide qué
      // asistente se pinta, y dejarlo vivo mezclaba los dos.
      setMig(null); setArchivos([]); setExcluidas([]); setElegido({}); setCola([]); setMigAplicados([])
      setEntidad(en.id); setEtiqueta(res.etiqueta ?? en.etiqueta); setDestino(en.destino); setCampos(res.campos as Campo[])
      // Un MAESTRO (personal, terceros, productos…) arranca en «Actualizar»: reimportar
      // sirve para rellenar/corregir, y dejarlo en «Saltar» hacía que 20 fichas que ya
      // existían se saltaran sin recibir los datos nuevos del archivo. Los HECHOS
      // (gastos/cobros, `repetible`) siguen en «Saltar»: ahí reimportar no debe pisar.
      setPolitica(res.repetible ? 'SALTAR' : 'ACTUALIZAR')
      // Los valores globales (empresa, moneda, unidad…) los declara cada entidad.
      // Si solo hay una opción posible, se elige sola.
      const ds = (res.defaults ?? []) as Default[]
      setDefs(ds)
      setGlobales(Object.fromEntries(ds.map(d => [
        d.campo, d.valor ?? (d.opciones?.length === 1 ? d.opciones[0].valor : ''),
      ])))
      setPlantillas(await listarPlantillasImport(en.id))
      setPaso('subir')
    } catch {
      toastError('No se ha podido cargar la entidad. Vuelve a intentarlo.')
    } finally {
      await ld.dismiss()
      setCargando(false)
    }
  }

  async function usarPlantilla(id: string) {
    if (!id) return
    const ld = toastLoading('Cargando…')
    try {
      const res = await cargarPlantillaImport(id)
      await ld.dismiss()
      if (!res.ok || !res.columnas) { toastError(res.error ?? 'No se pudo cargar la plantilla.'); return }
      // Solo se recupera el MAPEO de columnas; los valores globales (empresa,
      // moneda…) se eligen cada vez: son de este cliente, no del origen del archivo.
      setColumnas(Object.fromEntries(campos.map(c => [c.campo, res.columnas?.[c.campo] ?? ''])))
      setPolitica((res.politica as Politica) ?? 'SALTAR')
    } catch {
      toastError('No se ha podido cargar la plantilla. Vuelve a intentarlo.')
    } finally {
      await ld.dismiss()
    }
  }

  async function guardarPlantilla() {
    const ld = toastLoading('Guardando…')
    try {
      const res = await guardarPlantillaImport(nombrePlantilla, entidad, columnas, politica)
      await ld.dismiss()
      if (!res.ok) { toastError(res.error ?? 'No se pudo guardar.'); return }
      toastSuccess(`Plantilla «${nombrePlantilla.trim()}» guardada.`)
      setPlantillas(await listarPlantillasImport(entidad))
      setNombrePlantilla('')
    } catch {
      toastError('No se ha podido guardar la plantilla. Vuelve a intentarlo.')
    } finally {
      await ld.dismiss()
    }
  }

  async function deshacer() {
    setConfirmarDeshacer(false)
    setCargando(true)
    const ld = toastLoading('Deshaciendo…')
    try {
      const res = await deshacerLoteImport(loteId)
      await ld.dismiss()
      setCargando(false)
      if (!res.ok || !res.resumen) { toastError(res.error ?? 'No se pudo deshacer.'); return }
      setDeshecho(res.resumen)
      if (res.resumen.intactas === 0) toastSuccess('Importación deshecha.')
    } catch {
      toastError('No se ha podido deshacer. Vuelve a intentarlo.')
    } finally {
      await ld.dismiss()
      setCargando(false)
    }
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
    try {
      const res = await plantillaImport(entidad)
      await ld.dismiss()
      setBajandoPlantilla(false)
      if (!res.ok || !res.base64) { toastError(res.error ?? 'No se pudo generar la plantilla.'); return }
      descargarBase64(res.nombre ?? `plantilla-${entidad}.xlsx`, res.base64, XLSX_MIME)
    } catch {
      toastError('No se ha podido generar la plantilla. Vuelve a intentarlo.')
    } finally {
      await ld.dismiss()
      setBajandoPlantilla(false)
    }
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
      try {
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
      } catch {
        toastError('No se ha podido leer el archivo. Vuelve a intentarlo.')
      } finally {
        await ld.dismiss()
        setCargando(false)
      }
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

  /**
   * La subida va en dos tramos: primero el estado de rendimiento —obligatorio— y
   * después los mayores, que se añaden a él.
   */
  function subirTramo(files: File[]) {
    if (!files.length) return
    sumarArchivos(files, archivos, !fichaEstado)
  }

  /**
   * Cambia el Estado de rendimiento financiero por otro. NO se puede quitar sin
   * más: es el documento que sostiene la migración —sin él no hay cuadre y el
   * servidor no la aplica—, así que se sustituye en una sola lectura y no hay
   * ningún momento intermedio sin estado. Si el archivo elegido no es un estado,
   * la lectura se rechaza entera y todo se queda como estaba.
   */
  function cambiarEstado() {
    if (!fichaEstado || cargando || sinArchivos) return
    estadoRef.current?.click()
  }

  function onCambiarEstado(e: React.ChangeEvent<HTMLInputElement>) {
    const files = [...(e.target.files ?? [])]
    e.target.value = ''
    if (!files.length || !fichaEstado) return
    // El viejo sale del conjunto en la MISMA lectura en la que entra el nuevo.
    sumarArchivos(files, archivos.filter(a => a.nombre !== fichaEstado.nombre), true)
  }

  function onElegirVarios(e: React.ChangeEvent<HTMLInputElement>) {
    const files = [...(e.target.files ?? [])]
    e.target.value = ''
    subirTramo(files)
  }

  function onElegirMas(e: React.ChangeEvent<HTMLInputElement>) {
    const files = [...(e.target.files ?? [])]
    e.target.value = ''
    // Sin estado (lo han quitado desde aquí) se vuelve al primer tramo: lo que
    // toca subir es el estado, no otro mayor.
    if (files.length) sumarArchivos(files, archivos, !fichaEstado)
  }

  function onSoltarVarios(e: React.DragEvent) {
    e.preventDefault()
    setArrastrando(false)
    subirTramo([...(e.dataTransfer.files ?? [])])
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
    pol:   Politica = politica,
    /** El lote recién abierto por la migración: su estado todavía no se ha
     *  pintado, así que leerlo de arriba daría el del lote anterior. */
    ctx?: { loteId: string; columnas: Record<string, string>; total: number; defs: Default[]; globales: Record<string, string> },
  ) {
    const lid  = ctx?.loteId ?? loteId
    const cols = ctx?.columnas ?? columnas
    const dfs  = ctx?.defs ?? defs
    const gl   = ctx?.globales ?? globales
    const falta = dfs.find(d => d.obligatorio && !(gl[d.campo] ?? '').trim())
    if (falta) { toastError(`Indica ${falta.etiqueta.toLowerCase()}.`); return }
    const mapeo = {
      columnas: cols,
      defaults: Object.fromEntries(Object.entries(gl).filter(([, v]) => v.trim() !== '')),
      politica: pol,
      resoluciones: resol,
      repetidas:    rep,
    }
    setCargando(true); setInterrumpido('')
    const ld = toastLoading('Validando…')
    try {
      // El archivo se valida en tandas (una consulta por fila): se llama en bucle
      // hasta que el servidor dice que no queda nada, enseñando el avance.
      const acc = {
        total: ctx?.total ?? total, ok: 0, errores: 0, por_decidir: 0, nuevos: 0, actualizar: 0, saltar: 0,
        filas: [] as FilaMala[], resumen: [] as Total[], pendientes: [] as Pendiente[],
        repetidas: [] as FilaRepetida[],
      }
      let desde: number | null = 0
      let claves: ClavesVistas = []
      while (desde !== null) {
        const res = await validarLoteImport(lid, mapeo, desde, claves)
        if (!res.ok || !res.trozo) { await ld.dismiss(); setCargando(false); setProgreso(null); toastError(res.error ?? 'Error al validar.'); return }
        const t = res.trozo
        acc.total = t.total; acc.ok += t.ok; acc.errores += t.errores; acc.por_decidir += t.por_decidir
        acc.nuevos += t.nuevos; acc.actualizar += t.actualizar; acc.saltar += t.saltar
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
    } catch {
      toastError('Se ha cortado la comprobación. Vuelve a intentarlo.')
    } finally {
      await ld.dismiss()
      setCargando(false)
      setProgreso(null)
    }
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
    setCargando(true); setInterrumpido('')
    const ld = toastLoading('Importando…')
    try {
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
      setResumen(acc); setAuxiliares(aux)
      if (mig) setMigAplicados(prev => [...prev, { lote_id: loteId, etiqueta: etiquetaEnt, insertadas: acc.insertadas }])
      setPaso('hecho')
    } catch {
      toastError('Se ha cortado la importación. Vuelve a pulsar «Importar»: sigue por donde iba.')
    } finally {
      await ld.dismiss()
      setCargando(false)
      setProgreso(null)
    }
  }

  /** El siguiente lote de la migración (gastos → cobros). */
  async function siguienteLote() {
    if (!cola.length) return
    const [proximo, ...resto] = cola
    await abrirLote(proximo)
    // La cola se descuenta DESPUÉS: si esto se corta a la mitad —el operador sale
    // de la pantalla—, el lote que venía sigue en la cola y se puede reintentar.
    setCola(resto)
  }

  /** Deshacer una migración es deshacer sus lotes, al revés de como se aplicaron. */
  async function deshacerMigracion() {
    if (!mig) return
    setConfirmarDeshacer(false)
    setCargando(true)
    const ld = toastLoading('Deshaciendo…')
    try {
      const res = await deshacerMigracionLiangApp(mig.migracion_id)
      await ld.dismiss()
      setCargando(false)
      if (!res.ok || !res.lotes) { toastError(res.error ?? 'No se pudo deshacer.'); return }
      const total = res.lotes.reduce((a, l) => ({
        deshechas: a.deshechas + (l.resumen?.deshechas ?? 0),
        intactas:  a.intactas  + (l.resumen?.intactas ?? 0),
        motivos:   [...a.motivos, ...(l.resumen?.motivos ?? [])],
      }), { deshechas: 0, intactas: 0, motivos: [] as { fila: number; motivo: string }[] })
      setDeshecho(total)
      setCola([])
      if (total.intactas === 0) toastSuccess('Migración deshecha.')
    } catch {
      toastError('No se ha podido deshacer la migración. Vuelve a intentarlo.')
    } finally {
      await ld.dismiss()
      setCargando(false)
    }
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

  /** Un valor global del lote (empresa, moneda, política…). Función y no
   *  componente: como componente se remonta en cada render y el campo pierde el
   *  foco a media escritura. */
  function campoDefault(d: Default) {
    return (
      <div key={d.campo} className="input-group ter-col-span-2">
        <label htmlFor={`imprt-def-${d.campo}`}>
          {d.etiqueta}{d.obligatorio && <span className="required"> *</span>}
        </label>
        {d.opciones && d.opciones.length === 1 ? (
          <input id={`imprt-def-${d.campo}`} className="input input-static" readOnly value={d.opciones[0].etiqueta} />
        ) : d.opciones ? (
          <select id={`imprt-def-${d.campo}`} className="input" value={globales[d.campo] ?? ''}
            disabled={cargando}
            onChange={e => setGlobales({ ...globales, [d.campo]: e.target.value })}>
            <option value="">{d.obligatorio ? 'Selecciona…' : '— Ninguna —'}</option>
            {d.opciones.map(o => <option key={o.valor} value={o.valor}>{o.etiqueta}</option>)}
          </select>
        ) : (
          <input id={`imprt-def-${d.campo}`} className="input" type={d.tipo === 'fecha' ? 'date' : 'text'}
            value={globales[d.campo] ?? ''} disabled={cargando}
            onChange={e => setGlobales({ ...globales, [d.campo]: e.target.value })} />
        )}
        {d.ayuda && <span className="input-hint">{d.ayuda}</span>}
      </div>
    )
  }

  /** Apartar (o readmitir) una cuenta entera del reconocimiento. */
  function apartar(cuenta: number, dentro: boolean) {
    setExcluidas(prev => dentro ? prev.filter(c => c !== cuenta) : [...prev, cuenta])
  }

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
    setMig(null); setArchivos([]); setExcluidas([]); setElegido({}); setCola([]); setMigAplicados([])
    setInterrumpido('')
  }

  // La migración escribe en gastos Y en cobros: sin las dos entidades no se ofrece.
  const puedeMigrar = ['gastos', 'cobros'].every(id => entidadesVisibles.some(e => e.id === id))
  /** Grupos de gasto que siguen sin categoría: con alguno no se puede continuar. */
  const sinClasificar = (mig?.grupos ?? [])
    .filter(g => g.lineas > 0 && !(elegido[g.grupo] ?? g.propuesta)).length
  /** En una migración solo se pregunta lo que no trae respuesta: empresa y moneda. */
  const defsVisibles = mig ? defs.filter(d => !d.valor) : defs
  /**
   * Por qué no se puede continuar. Vacío = se puede. Va a la vista, junto al
   * botón: lo que antes era un toast al pulsar (o un botón apagado sin motivo)
   * dejaba al operador buscando qué le faltaba.
   */
  const faltaDef = defs.find(d => d.obligatorio && !d.valor && !(globales[d.campo] ?? '').trim())
  /** Las cuentas que de verdad entran: las apartadas no tienen que cuadrar. */
  const enCuadre = mig ? mig.cuadre.filter(f => !excluidas.includes(f.cuenta)) : []
  const bloqueo = !mig ? ''
    : mig.errores.length ? mig.errores[0]
    : !mig.lotes.length  ? 'Ningún archivo trae cuentas que se puedan importar. Revisa los libros mayores subidos.'
    // El cuadre se comprueba desde aquí y no solo al final: el servidor se niega
    // a aplicar sin él (D2), y descubrirlo dos pasos después es trabajo tirado.
    : !conEstado(mig)    ? 'Falta el Estado de rendimiento financiero. Vuelve a subir archivos y añádelo: sin él la migración no se aplica.'
    : !enCuadre.length   ? 'No queda ninguna cuenta dentro de la migración. Vuelve a incluir al menos una.'
    : enCuadre.some(f => !f.cuadra) ? 'Hay cuentas que no cuadran con tu Estado de rendimiento financiero. Apártalas o corrige sus archivos.'
    : faltaDef           ? `Indica ${faltaDef.etiqueta.toLowerCase()} en «Dónde entra».`
    : sinClasificar > 0  ? `Elige la categoría de ${sinClasificar} ${sinClasificar === 1 ? 'grupo' : 'grupos'} de gasto.`
    : ''
  /** Mayores ya leídos: al volver al paso de subir hay que decir qué hay dentro. */
  const mayoresSubidos = mig?.fichas.filter(f => f.tipo === 'mayor').length ?? 0

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

      {/* Fuera de los pasos: cambiar el estado se ofrece tanto al subir como en
          el reconocimiento, y el selector tiene que existir en los dos sitios. */}
      <input ref={estadoRef} type="file" accept=".xlsx" className="imprt-drop-input"
        onChange={onCambiarEstado} disabled={cargando || sinArchivos}
        aria-label="Cambiar el estado de rendimiento financiero" />

      <div className="imprt-steps">
        {PASOS.map((p, i) => {
          const volver = puedeVolver(p.id, i)
          // En una migración no se mapea nada: el paso es el reconocimiento.
          const label = !mig ? p.label
            : p.id === 'mapear' ? 'Reconocer'
            : p.id === 'subir'  ? 'Subir archivos'
            : p.label
          return (
            <button key={p.id} type="button" disabled={!volver || cargando}
              onClick={() => setPaso(p.id)}
              aria-current={p.id === paso ? 'step' : undefined}
              title={volver ? `Volver a ${label.toLowerCase()}` : undefined}
              className={`imprt-step ${p.id === paso ? 'imprt-step-activo' : i < idxPaso ? 'imprt-step-hecho' : ''} ${volver ? 'imprt-step-atras' : ''}`}>
              <span className="imprt-step-num">{i < idxPaso ? <Check size={13} strokeWidth={3} /> : i + 1}</span>
              {label}
            </button>
          )
        })}
      </div>

      {interrumpido && (
        <p className="alert alert-warning imprt-corte">
          <AlertTriangle size={16} strokeWidth={2} />
          <span>{interrumpido}</span>
          <button type="button" className="btn btn-aviso btn-sm" disabled={cargando}
            onClick={() => setInterrumpido('')}>Entendido</button>
        </p>
      )}

      {/* ── Paso 1: entidad ── */}
      {paso === 'entidad' && (
        <div className="card">
          {/* La puerta nombrada del origen: quien viene de LiangApp tiene que ver
              que esto es para él, no deducirlo de una entidad de la rejilla. */}
          {puedeMigrar && (
            <>
              <p className="modal-body-text">¿Vienes de LiangApp?</p>
              <button type="button" className="imprt-origen" disabled={cargando} onClick={empezarMigracion}>
                <FileSpreadsheet size={22} strokeWidth={1.5} />
                <span className="imprt-origen-que">
                  <strong>Migrar desde LiangApp</strong>
                  <span>Primero el Estado de rendimiento financiero y después los libros mayores del período.</span>
                </span>
                <ArrowRight size={16} strokeWidth={2} />
              </button>
            </>
          )}
          <p className="modal-body-text">{puedeMigrar ? 'O elige qué importar' : '¿Qué vas a importar?'}</p>
          <div className="imprt-entidad-grid">
            {entidadesVisibles.map(en => (
              <button key={en.id} type="button" className="imprt-entidad"
                disabled={!en.disponible || cargando} onClick={() => elegirEntidad(en)}>
                <strong>{en.etiqueta}</strong>
                <span>{en.disponible ? en.desc : 'Próximamente'}</span>
              </button>
            ))}
            {entidadesVisibles.length === 0 && (
              <p className="input-hint">No hay entidades de importación disponibles para los módulos contratados.</p>
            )}
          </div>
        </div>
      )}

      {/* ── Paso 2: subir (migración) ── */}
      {paso === 'subir' && mig && (
        <div className="card">
          <AyudaLiangApp hayEstado={!!fichaEstado} />
          {fichaEstado && (
            <EstadoLiangApp nombre={fichaEstado.nombre} cargando={cargando || sinArchivos}
              onCambiar={cambiarEstado} />
          )}
          {mayoresSubidos > 0 && (
            <p className="alert alert-info imprt-mig-listo">
              <FileSpreadsheet size={15} strokeWidth={2} />
              <span className="imprt-mig-listo-nombre">
                <strong>{mayoresSubidos}</strong> {mayoresSubidos === 1 ? 'libro mayor ya subido' : 'libros mayores ya subidos'}
              </span>
              <button type="button" className="btn btn-aviso btn-sm" disabled={cargando}
                onClick={() => setPaso('mapear')}>Ver</button>
            </p>
          )}
          {sinArchivos && (
            <p className="imprt-bloqueo"><AlertTriangle size={15} strokeWidth={2} /> {AVISO_SIN_ARCHIVOS}</p>
          )}
          <input ref={fileRef} type="file" accept=".xlsx" multiple={!!fichaEstado}
            className="imprt-drop-input" onChange={onElegirVarios} disabled={cargando || sinArchivos}
            aria-label={fichaEstado ? 'Elegir los libros mayores' : 'Elegir el estado de rendimiento financiero'} />
          <button type="button" className={`imprt-drop ${arrastrando ? 'imprt-drop-activa' : ''}`}
            onClick={() => fileRef.current?.click()} disabled={cargando || sinArchivos}
            onDragOver={e => { e.preventDefault(); setArrastrando(true) }}
            onDragLeave={() => setArrastrando(false)}
            onDrop={onSoltarVarios}>
            <FileSpreadsheet size={32} strokeWidth={1.5} />
            {cargando
              ? <strong>{avisoCarga}</strong>
              : fichaEstado
                ? <>
                    <strong>Elige los libros mayores o arrástralos aquí</strong>
                    <span>Los .xlsx de LiangApp, uno por cuenta. Varios a la vez, hasta 5 MB en total.</span>
                  </>
                : <>
                    <strong>Elige el Estado de rendimiento financiero o arrástralo aquí</strong>
                    <span>El .xlsx tal como sale de LiangApp, sin retocar.</span>
                  </>}
          </button>
          <div className="imprt-acciones">
            <button type="button" className="btn btn-ghost" disabled={cargando}
              onClick={() => { setMig(null); setArchivos([]); setPaso('entidad') }}>
              <ArrowLeft size={15} strokeWidth={2} /> Atrás
            </button>
          </div>
        </div>
      )}

      {/* ── Paso 2: subir ── */}
      {paso === 'subir' && !mig && (
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
              <select id="imprt-enc" className="input" value={encoding} disabled={cargando}
                onChange={e => setEncoding(e.target.value)}>
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
            <button type="button" className="btn btn-ghost" disabled={cargando} onClick={() => setPaso('entidad')}>
              <ArrowLeft size={15} strokeWidth={2} /> Atrás
            </button>
          </div>
        </div>
      )}

      {/* ── Paso 3: reconocimiento (migración) ──
          Lo que se ha entendido de cada archivo, con la salida a mano: apartar
          una cuenta es la única manera de seguir cuando el reparto automático se
          equivoca, y sin ella el operador se queda encerrado. */}
      {paso === 'mapear' && mig && (
        <div className="imprt-revisar">
          <div className="card">
            <div className="card-header">
              <h2 className="card-title card-title-sm">{mig.empresa || 'Migración desde LiangApp'}</h2>
              {mig.periodo && <span className="text-xs-muted">{mig.periodo}</span>}
            </div>
            {mig.errores.map(e => (
              <div key={e} className="alert alert-error"><AlertTriangle size={16} strokeWidth={2} /> {e}</div>
            ))}
            {mig.avisos.map(a => (
              <div key={a} className="alert alert-warning"><AlertTriangle size={16} strokeWidth={2} /> {a}</div>
            ))}
            <FichasLiangApp fichas={mig.fichas} excluidas={excluidas} onApartar={apartar}
              onQuitar={quitarArchivo} onCambiarEstado={cambiarEstado} onAnadir={onElegirMas}
              cargando={cargando} sinArchivos={sinArchivos} />
          </div>

          {defsVisibles.length > 0 && (
            <div className="card">
              <div className="card-header">
                <h2 className="card-title card-title-sm">Dónde entra</h2>
              </div>
              <div className="ter-form-grid">{defsVisibles.map(campoDefault)}</div>
            </div>
          )}

          {mig.grupos.length > 0 && (
            <div className="card">
              <div className="card-header">
                <h2 className="card-title card-title-sm">Categoría de cada gasto</h2>
                <span className="text-xs-muted">
                  {sinClasificar > 0 ? `${sinClasificar} sin categoría` : 'Todo clasificado'}
                </span>
              </div>
              <p className="modal-body-text">
                Los apuntes van agrupados por lo que dicen. Cambia el que no cuadre.
              </p>
              <GruposLiangApp grupos={mig.grupos} elegido={elegido} cargando={cargando}
                onElegir={(g, clave) => setElegido(prev => ({ ...prev, [g]: clave }))} />
            </div>
          )}

          {mig.cuadre.length > 0 && <CuadreLiangApp mig={mig} excluidas={excluidas} enSitio />}

          <div className="card">
            {bloqueo && (
              <p className="imprt-bloqueo"><AlertTriangle size={15} strokeWidth={2} /> {bloqueo}</p>
            )}
            <div className="imprt-acciones">
              <button type="button" className="btn btn-ghost" disabled={cargando} onClick={() => setPaso('subir')}>
                <ArrowLeft size={15} strokeWidth={2} /> Atrás
              </button>
              <button type="button" className="btn btn-primary" onClick={continuarMigracion}
                disabled={cargando || !!bloqueo}>
                {cargando
                  ? <><span className="spinner spinner-sm" /> Comprobando {etiquetaProgreso}…</>
                  : <>Continuar <ArrowRight size={15} strokeWidth={2} /></>}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Paso 3: mapear ── */}
      {paso === 'mapear' && !mig && (
        <div className="card">
          <p className="modal-body-text">Se detectaron <strong>{total}</strong> filas. Empareja cada campo con una columna del archivo.</p>

          {/* Lo que el archivo trae mal sin llegar a impedir el trabajo. */}
          {avisos.map(a => (
            <div key={a} className="alert alert-warning">
              <AlertTriangle size={16} strokeWidth={2} /> {a}
            </div>
          ))}

          <div className="ter-form-grid">
            {defs.map(campoDefault)}
            <div className="input-group ter-col-span-2">
              <label htmlFor="imprt-pol">Si ya existe</label>
              <select id="imprt-pol" className="input" value={politica} disabled={cargando}
                onChange={e => setPolitica(e.target.value as Politica)}>
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
                <select id="imprt-plt" className="input" defaultValue="" disabled={cargando}
                  onChange={e => usarPlantilla(e.target.value)}>
                  <option value="">— Mapear a mano —</option>
                  {plantillas.map(p => <option key={p.plantilla_id} value={p.plantilla_id}>{p.nombre}</option>)}
                </select>
              </div>
            )}
            <div className="input-group ter-col-span-3">
              <label htmlFor="imprt-plt-nom">Guardar este mapeo para reutilizarlo</label>
              <div className="imprt-plantilla-guardar">
                <input id="imprt-plt-nom" className="input" value={nombrePlantilla} placeholder="Ej.: Export de Zoho"
                  disabled={cargando} onChange={e => setNombrePlantilla(e.target.value)} />
                <button type="button" className="btn btn-secondary" onClick={guardarPlantilla}
                  disabled={cargando || !nombrePlantilla.trim()}>
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
                <select className="input" value={columnas[c.campo] ?? ''} disabled={cargando}
                  aria-label={`Columna para ${c.etiqueta}`}
                  onChange={e => setColumnas({ ...columnas, [c.campo]: e.target.value })}>
                  <option value="">— No importar —</option>
                  {cabeceras.map(cab => <option key={cab} value={cab}>{cab}</option>)}
                </select>
              </div>
            ))}
          </div>

          <div className="imprt-acciones">
            <button type="button" className="btn btn-ghost" disabled={cargando} onClick={() => setPaso('subir')}>
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
          {/* El cuadre va primero: es lo que decide si esto se puede aplicar. */}
          {mig && <CuadreLiangApp mig={mig} excluidas={excluidas} />}
          <div className="card">
            <div className="imprt-tiles">
              <div className="imprt-tile"><strong>{resultado.total}</strong><span>Filas</span></div>
              <div className="imprt-tile"><strong>{resultado.nuevos + resultado.actualizar}</strong><span>Se importarán</span></div>
              {resultado.saltar > 0 && (
                <div className="imprt-tile"><strong>{resultado.saltar}</strong><span>Ya existen (se saltan)</span></div>
              )}
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
              cargando={cargando}
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
              cargando={cargando}
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
              {resultado.nuevos > 0 && (
                <li>
                  <Check size={14} strokeWidth={2.5} />
                  <span>Se {resultado.nuevos === 1 ? 'creará' : 'crearán'} <strong>{resultado.nuevos} {etiquetaEntidad.toLowerCase()}</strong> {resultado.nuevos === 1 ? 'nueva' : 'nuevas'} (no existían).</span>
                </li>
              )}
              {resultado.actualizar > 0 && (
                <li>
                  <Check size={14} strokeWidth={2.5} />
                  <span>Se {resultado.actualizar === 1 ? 'actualizará' : 'actualizarán'} <strong>{resultado.actualizar} {etiquetaEntidad.toLowerCase()}</strong> que ya {resultado.actualizar === 1 ? 'existe' : 'existen'} con los datos del archivo (solo las columnas que trae; lo demás se queda igual).</span>
                </li>
              )}
              {resultado.saltar > 0 && (
                <li className="imprt-plan-warn">
                  <AlertTriangle size={14} strokeWidth={2} />
                  <span>
                    <strong>{resultado.saltar} {etiquetaEntidad.toLowerCase()}</strong> ya {resultado.saltar === 1 ? 'existe' : 'existen'} y <strong>se {resultado.saltar === 1 ? 'saltará' : 'saltarán'}</strong>: NO recibirán lo que trae el archivo.
                    <button type="button" className="btn btn-sm btn-primary imprt-plan-accion"
                      disabled={cargando}
                      onClick={() => { setPolitica('ACTUALIZAR'); validar(resoluciones, repetidas, 'ACTUALIZAR') }}>
                      Actualizar {resultado.saltar === 1 ? 'esa ficha' : `esas ${resultado.saltar}`} con el archivo
                    </button>
                  </span>
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
              {politica === 'SALTAR' && resultado.saltar === 0 && (
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
                      cargando={cargando}
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
              <button type="button" className="btn btn-ghost" onClick={() => setPaso('mapear')}
                disabled={cargando || (!!mig && migAplicados.length > 0)}
                title={mig && migAplicados.length > 0
                  ? 'Ya se ha importado parte de la migración: para cambiar los archivos hay que deshacerla.'
                  : undefined}>
                <ArrowLeft size={15} strokeWidth={2} /> {mig ? 'Volver al reconocimiento' : 'Atrás'}
              </button>
              {hayDecisionesSinAplicar ? (
                <button type="button" className="btn btn-primary" onClick={() => validar()} disabled={cargando}>
                  {cargando
                    ? <><span className="spinner spinner-sm" /> Comprobando {etiquetaProgreso}…</>
                    : <>Recalcular con tus decisiones <ArrowRight size={15} strokeWidth={2} /></>}
                </button>
              ) : (
                <button type="button" className="btn btn-primary" onClick={aplicar}
                  disabled={cargando || (resultado.nuevos + resultado.actualizar) === 0 || (!!mig && !cuadraTodo(mig, excluidas))}>
                  {cargando
                    ? <><span className="spinner spinner-sm" /> Importando {etiquetaProgreso}…</>
                    : <>Importar {resultado.nuevos + resultado.actualizar} {(resultado.nuevos + resultado.actualizar) === 1 ? 'ficha' : 'fichas'}</>}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Paso 5: listo ── */}
      {paso === 'hecho' && resumen && (
        <div className="card">
          <div className="alert alert-success">
            <CheckCircle2 size={16} strokeWidth={2} /> {mig ? `${etiquetaEnt} importados.` : 'Importación completada.'}
          </div>
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

          {/* La migración va por lotes y en orden: lo hecho hasta ahora, y lo
              que falta como el siguiente paso, no como una tarea suelta. */}
          {mig && migAplicados.length > 1 && <AplicadosLiangApp aplicados={migAplicados} />}
          {mig && cola.length > 0 && !deshecho && (
            <div className="alert alert-info">
              Falta el lote de {cola[0].etiqueta.toLowerCase()}: {cola[0].filas} líneas.
            </div>
          )}
          {mig && cola.length === 0 && !deshecho && mig.facturas.length > 0 && (
            <FacturasLiangApp facturas={mig.facturas} bajando={bajandoFacturas} onDescargar={descargarFacturas} />
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
              <Undo2 size={15} strokeWidth={2} /> {mig ? 'Deshacer la migración' : 'Deshacer esta importación'}
            </button>
            <div className="imprt-acciones-fin">
              {mig && cola.length > 0 && !deshecho ? (
                <button type="button" className="btn btn-primary" onClick={siguienteLote} disabled={cargando}>
                  {cargando
                    ? <><span className="spinner spinner-sm" /> Comprobando {etiquetaProgreso}…</>
                    : <>Continuar con {cola[0].etiqueta.toLowerCase()} <ArrowRight size={15} strokeWidth={2} /></>}
                </button>
              ) : (
                <>
                  <button type="button" className="btn btn-secondary" onClick={reiniciar} disabled={cargando}>
                    {mig ? 'Importar otra cosa' : 'Importar otro archivo'}
                  </button>
                  {destino && <Link className="btn btn-primary" href={destino}>Ver {etiquetaEnt.toLowerCase()}</Link>}
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {confirmarDeshacer && (
        <ConfirmDialog
          title={mig ? '¿Deshacer la migración?' : '¿Deshacer esta importación?'}
          body={mig
            ? <>Se quitará todo lo que ha creado esta migración ({migAplicados.reduce((n, a) => n + a.insertadas, 0)} filas). Lo que ya se esté usando se queda como está y se te dirá cuál.</>
            : <>Se quitará lo que creó este archivo ({resumen?.insertadas} filas). Lo que ya se esté usando —o el stock que ya se haya movido— se queda como está y se te dirá cuál. Lo actualizado no se revierte.</>}
          confirmLabel="Deshacer"
          danger
          onConfirm={mig ? deshacerMigracion : deshacer}
          onCancel={() => setConfirmarDeshacer(false)}
        />
      )}
    </div>
  )
}
