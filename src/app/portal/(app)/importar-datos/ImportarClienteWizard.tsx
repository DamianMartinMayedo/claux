'use client'

// Asistente de importación de AUTOSERVICIO (el cliente se importa solo). Copia MÁS
// GUIADA del wizard del equipo (`ImportarWizard.tsx`): mismos pasos y misma lógica de
// revisión (viene del motor compartido), pero con la barandilla del cliente —plantilla
// obligatoria antes de subir, alertas explícitas en cada paso, sin «guardar plantilla
// de mapeo» (esa tabla es global)— y un banner para pedir que lo haga el equipo.
//
// El wizard del equipo NO se toca: esto es la cáscara duplicada a propósito (la lógica
// arriesgada vive en el motor, no aquí). Llama a `importar-cliente.ts`, con su candado.

import { useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { toastError, toastSuccess, toastLoading } from '@/app/contexts/ToastContext'
import { ArrowLeft, ArrowRight, Check, CheckCircle2, AlertTriangle, Download, FileSpreadsheet, LifeBuoy, Undo2, Lock } from 'lucide-react'
import { ConfirmDialog } from '@/components/portal/Dialog'
import { formatearImporte, fusionarTotales } from '@/lib/importador/util'
import { aBase64 } from '@/lib/subir-archivo'
import type {
  ClavesVistas, DecisionRepetidas, FilaRepetida, Pendiente, Resolucion,
} from '@/lib/importador/tipos'
import {
  obtenerCamposEntidad, crearLoteImport, validarLoteImport, aplicarLoteImport,
  deshacerLoteImport, plantillaImport, solicitarAyudaMigracion,
} from '@/app/actions/portal/importar-cliente'

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

export type EntidadImportable = { entidad: string; etiqueta: string }

/**
 * Presentación de cada entidad (descripción y adónde lleva ya importada). La LISTA
 * de qué se puede importar la decide el servidor (permiso + módulo contratado) y
 * llega por props; esto solo la viste. Una entidad futura sin ficha aquí se pinta
 * con su etiqueta y sin enlace, no rompe.
 */
const META: Record<string, { desc: string; destino: string }> = {
  terceros:        { desc: 'Tus clientes y proveedores: contacto y datos de pago.',        destino: '/portal/terceros' },
  productos:       { desc: 'Catálogo físico: precios, costos y unidad.',                   destino: '/portal/productos' },
  servicios:       { desc: 'Catálogo de servicios y suscribibles.',                        destino: '/portal/servicios' },
  catalogo:        { desc: 'De cara al público: nombres, precios y secciones. Sin fotos.', destino: '/portal/catalogo' },
  profesionales:   { desc: 'Barberos, estilistas… solo nombre y tipo.',                    destino: '/portal/citas' },
  suscripciones:   { desc: 'Acuerdos recurrentes por cliente (los servicios, ya creados).', destino: '/portal/suscripciones' },
  personal:        { desc: 'Tus trabajadores: identidad, puesto y contacto.',              destino: '/portal/rrhh' },
  stock_inicial:   { desc: 'Existencias a la fecha de corte (catálogo y almacenes ya creados).', destino: '/portal/inventario' },
  tesoreria_saldo: { desc: 'Lo que hay en cada cuenta a la fecha de corte.',               destino: '/portal/tesoreria' },
  gastos:          { desc: 'Histórico de gastos por categoría. Lo pendiente va a CxP.',    destino: '/portal/gastos' },
  cobros:          { desc: 'Histórico de ingresos no facturados. Lo pendiente va a CxC.',  destino: '/portal/gastos' },
}

const PASOS: { id: Paso; label: string }[] = [
  { id: 'entidad', label: 'Qué importar' },
  { id: 'subir',   label: 'Plantilla y archivo' },
  { id: 'mapear',  label: 'Revisar columnas' },
  { id: 'validar', label: 'Comprobar' },
  { id: 'hecho',   label: 'Listo' },
]

/**
 * Tope de tamaño de archivo (barandilla de autoservicio, §8). 5 MB da de sobra para
 * una carta, un catálogo o años de gastos en hoja de cálculo, y frena el archivo
 * accidental (un export con imágenes, un volcado entero) que no cabría en el tiempo
 * de una función. El servidor lo vuelve a comprobar (última red).
 */
const TOPE_ARCHIVO_MB = 5
const TOPE_ARCHIVO    = TOPE_ARCHIVO_MB * 1024 * 1024

/**
 * Entidades de ESTADO o HISTÓRICO financiero (Tier 2): lo que traen vivió ANTES de
 * empezar a operar en vivo. Necesitan la barandilla de la fecha de corte y el aviso
 * anti-doble-conteo (§8); los maestros (fichas: clientes, catálogo, personal) no.
 */
const TIER2 = new Set(['gastos', 'cobros', 'stock_inicial', 'tesoreria_saldo'])

/**
 * El aviso de corte, redactado según la naturaleza del dato: los FLUJOS (gastos,
 * cobros) llevan fecha por fila y el riesgo es contar dos veces un mismo período;
 * los ESTADOS (stock, saldos) son una foto a UNA fecha y el riesgo es volver a
 * subirla más adelante. Devuelve null para los maestros, que no llevan aviso.
 */
function avisoCorte(entidad: string): { titulo: string; cuerpo: string } | null {
  if (entidad === 'gastos' || entidad === 'cobros') {
    return {
      titulo: 'Esto es tu histórico anterior, no el día a día',
      cuerpo: 'Cada fila lleva su fecha: es lo que pasó ANTES de empezar con CLAUX. Fija una fecha de corte y, a partir de ahí, registra en vivo. No subas el resumen de un mes y además lo registres a mano ese mismo mes: contaría dos veces.',
    }
  }
  if (entidad === 'stock_inicial' || entidad === 'tesoreria_saldo') {
    const foto = entidad === 'stock_inicial' ? 'las existencias' : 'los saldos'
    return {
      titulo: `Es la foto de ${foto} a una fecha`,
      cuerpo: `Pon la fecha de corte y sube lo que tenías ESE día. A partir de ahí, deja que CLAUX lleve los movimientos: no vuelvas a subir esta foto más adelante o duplicarás.`,
    }
  }
  return null
}

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
 * Agrupa filas con error por motivo IDÉNTICO: la misma causa repetida en 40 filas
 * se lee mejor como una línea con un contador que como 40 filas iguales.
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

/** Por encima de esto, vincular una a una deja de ahorrar tiempo frente a corregir
 *  el archivo de origen: se retira el panel y se enseña un resumen. */
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
 * Para comparar cabeceras con nombres de campo. Se come el asterisco final porque
 * nuestra plantilla marca así lo obligatorio: «Nombre *» tiene que seguir
 * emparejando con el campo «Nombre».
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
 * Elegir una ficha entre las que ya existen, BUSCANDO en vez de desplegando. Reusa
 * la familia `.ac-*` del portal con sus detalles ya resueltos (blur con retardo,
 * ↑/↓/Enter/Escape, Enter que ELIGE y no envía). Idéntico al del equipo.
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

/** Lo que se ha decidido sobre un nombre, EN CONSECUENCIAS. */
function consecuencia(p: Pendiente, r: Resolucion | undefined): string | null {
  if (!r) return null
  if (r.accion === 'CREAR')  return `Se creará «${p.texto}»`
  if (r.accion === 'OMITIR') return 'Se dejará en blanco'
  if (r.accion === 'RECHAZAR') return `Sus ${p.filas === 1 ? 'fila' : `${p.filas} filas`} se quedarán fuera`
  const elegida = p.opciones.find(o => o.valor === r.destino)?.etiqueta
  return elegida ? `Se usará «${elegida}»` : null
}

/** Un nombre del archivo y qué hacer con él. Buscar ficha y decidir acción son dos
 *  cosas distintas: el buscador busca, las acciones son botones a la vista. */
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

/** Los nombres del archivo que NO cuadran con nada y hay que decidir. */
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

/** Filas que dicen lo mismo que otra fila del archivo. */
function PanelRepetidas({
  repetidas, decision, sinAplicar, onDecidir,
}: {
  repetidas:  FilaRepetida[]
  decision:   DecisionRepetidas
  sinAplicar: boolean
  onDecidir:  (d: DecisionRepetidas) => void
}) {
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

/**
 * Banner de ayuda: «¿prefieres que lo hagamos nosotros?». Crea una solicitud interna
 * al equipo (servicio de pago). No manda correo al cliente; el equipo la atiende
 * desde la ficha. La idempotencia la da el servidor (una solicitud viva por cliente).
 */
function BannerAyuda() {
  const [enviado, setEnviado]   = useState(false)
  const [enviando, setEnviando] = useState(false)
  const [abierto, setAbierto]   = useState(false)
  const [mensaje, setMensaje]   = useState('')

  async function enviar() {
    setEnviando(true)
    const ld = toastLoading('Enviando solicitud…')
    const res = await solicitarAyudaMigracion(mensaje)
    await ld.dismiss()
    setEnviando(false)
    if (!res.ok) { toastError(res.error ?? 'No se pudo enviar la solicitud.'); return }
    setEnviado(true)
    toastSuccess('Solicitud enviada. El equipo de CLAUX te contactará.')
  }

  return (
    <div className="card imprt-banner-ayuda">
      <div className="card-header">
        <h2 className="card-title card-title-sm">¿Prefieres que lo hagamos nosotros?</h2>
      </div>
      <p className="modal-body-text">
        Si tienes muchos datos o no te aclaras, el equipo de CLAUX puede hacer tu migración por ti.
        Es un servicio de pago: te pasamos un presupuesto a medida y no cobramos nada hasta que lo aceptes.
      </p>

      {enviado ? (
        <div className="alert alert-success">
          <CheckCircle2 size={16} strokeWidth={2} /> Solicitud enviada. Te contactaremos pronto.
        </div>
      ) : !abierto ? (
        <div className="imprt-acciones">
          <button type="button" className="btn btn-secondary" onClick={() => setAbierto(true)}>
            <LifeBuoy size={15} strokeWidth={2} /> Solicitar ayuda del equipo
          </button>
        </div>
      ) : (
        <div className="input-group">
          <label htmlFor="imprt-ayuda-msg">Cuéntanos qué necesitas (opcional)</label>
          <textarea id="imprt-ayuda-msg" className="input input-textarea" rows={3}
            value={mensaje} maxLength={2000} disabled={enviando}
            placeholder="Ej.: Tengo tres años de gastos y cobros de dos empresas en Excel."
            onChange={e => setMensaje(e.target.value)} />
          <div className="imprt-acciones">
            <button type="button" className="btn btn-ghost" onClick={() => setAbierto(false)} disabled={enviando}>
              Cancelar
            </button>
            <button type="button" className="btn btn-primary" onClick={enviar} disabled={enviando}>
              {enviando ? <><span className="spinner spinner-sm" /> Enviando…</> : 'Enviar solicitud'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export default function ImportarClienteWizard({ entidades }: { entidades: EntidadImportable[] }) {
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
  // Barandilla del cliente: hay que descargar la plantilla modelo ANTES de poder
  // subir nada. No obliga a usarla, pero garantiza que la ha visto (plan §6).
  const [plantillaBajada, setPlantillaBajada] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const [columnas, setColumnas]   = useState<Record<string, string>>({})
  const [globales, setGlobales]   = useState<Record<string, string>>({})
  const [politica, setPolitica]   = useState<Politica>('SALTAR')

  const [resultado, setResultado] = useState<{
    total: number; ok: number; errores: number; por_decidir: number
    nuevos: number; actualizar: number; saltar: number
    filas: FilaMala[]; resumen: Total[]; pendientes: Pendiente[]; repetidas: FilaRepetida[]
  } | null>(null)
  const [resoluciones, setResoluciones] = useState<Record<string, Resolucion>>({})
  const [sinAplicar, setSinAplicar] = useState<string[]>([])
  const [repetidas, setRepetidas] = useState<DecisionRepetidas>('DECIDIR')
  const [repetidasAplicadas, setRepetidasAplicadas] = useState<DecisionRepetidas>('DECIDIR')
  const [resumen, setResumen]     = useState<{ insertadas: number; actualizadas: number; saltadas: number; errores: number } | null>(null)
  const [auxiliares, setAuxiliares] = useState<{ etiqueta: string; cantidad: number }[]>([])

  const [confirmarDeshacer, setConfirmarDeshacer] = useState(false)
  const [deshecho, setDeshecho]   = useState<{ deshechas: number; intactas: number; motivos: { fila: number; motivo: string }[] } | null>(null)

  const idxPaso = PASOS.findIndex(p => p.id === paso)
  // Aviso de fecha de corte / anti-doble-conteo para las entidades Tier 2 (§8). Se
  // calcula una vez y se reparte por los pasos que lo necesitan.
  const corte = TIER2.has(entidad) ? avisoCorte(entidad) : null

  /** Volver a un paso ya recorrido. Solo hacia atrás y solo si ese paso se sostiene. */
  function puedeVolver(destino: Paso, i: number): boolean {
    if (i >= idxPaso || paso === 'hecho') return false
    return destino === 'entidad' ? true
      : destino === 'subir'      ? !!entidad
      : destino === 'mapear'     ? !!loteId
      : !!resultado
  }

  async function elegirEntidad(en: EntidadImportable) {
    setCargando(true)
    const ld = toastLoading('Cargando…')
    const res = await obtenerCamposEntidad(en.entidad)
    await ld.dismiss()
    setCargando(false)
    if (!res.ok || !res.campos) { toastError(res.error ?? 'Error inesperado.'); return }
    // El archivo pertenece a la entidad con la que se subió: al elegir entidad se
    // suelta, o se acabaría mapeando las columnas de un archivo a los campos de otra.
    setLoteId(''); setCabeceras([]); setTotal(0); setColumnas({}); setAvisos([]); setResultado(null)
    setResoluciones({}); setPlantillaBajada(false)
    setEntidad(en.entidad); setEtiqueta(en.etiqueta); setDestino(META[en.entidad]?.destino ?? ''); setCampos(res.campos as Campo[])
    // Un MAESTRO arranca en «Actualizar»: reimportar sirve para rellenar/corregir, y
    // dejarlo en «Saltar» hacía que las fichas ya existentes se saltaran sin recibir los
    // datos nuevos del archivo. Los HECHOS (`repetible`) siguen en «Saltar».
    setPolitica(res.repetible ? 'SALTAR' : 'ACTUALIZAR')
    const ds = (res.defaults ?? []) as Default[]
    setDefs(ds)
    setGlobales(Object.fromEntries(ds.map(d => [
      d.campo, d.valor ?? (d.opciones?.length === 1 ? d.opciones[0].valor : ''),
    ])))
    setPaso('subir')
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

  /** Plantilla modelo en EXCEL (recomendada): se genera en servidor con la marca
   *  CLAUX, cabeceras con estilo y una hoja de instrucciones. */
  async function descargarPlantillaExcel() {
    if (bajandoPlantilla) return
    setBajandoPlantilla(true)
    const ld = toastLoading('Generando…')
    const res = await plantillaImport(entidad)
    await ld.dismiss()
    setBajandoPlantilla(false)
    if (!res.ok || !res.base64) { toastError(res.error ?? 'No se pudo generar la plantilla.'); return }
    descargarBase64(res.nombre ?? `plantilla-${entidad}.xlsx`, res.base64, XLSX_MIME)
    setPlantillaBajada(true)
  }

  /** Alternativa en CSV para quien use Google Sheets u otra herramienta. */
  function descargarPlantillaCsv() {
    const filas = [campos.map(c => celdaCsv(c.etiqueta + (c.obligatorio ? ' *' : ''))).join(',')]
    if (campos.some(c => c.ejemplo)) filas.push(campos.map(c => celdaCsv(c.ejemplo ?? '')).join(','))
    descargarCsv(`plantilla-${entidad}.csv`, filas.join('\n') + '\n')
    setPlantillaBajada(true)
  }

  async function procesarArchivo(file: File) {
    if (file.size > TOPE_ARCHIVO) {
      toastError(`El archivo pesa demasiado (máx. ${TOPE_ARCHIVO_MB} MB). Divídelo en partes más pequeñas y súbelas por separado.`)
      return
    }
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
      setAvisos(res.avisos ?? []); setResultado(null); setResoluciones({})
      // Auto-mapeo por nombre de campo, etiqueta o alias (normalizando acentos).
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
    if (!plantillaBajada) return
    const file = e.dataTransfer.files?.[0]
    if (file) procesarArchivo(file)
  }

  /** Dry-run. `resol` se pasa explícito al revalidar tras decidir. */
  async function validar(
    resol: Record<string, Resolucion> = resoluciones,
    rep:   DecisionRepetidas = repetidas,
    pol:   Politica = politica,
  ) {
    const falta = defs.find(d => d.obligatorio && !(globales[d.campo] ?? '').trim())
    if (falta) { toastError(`Indica ${falta.etiqueta.toLowerCase()}.`); return }
    const mapeo = {
      columnas,
      defaults: Object.fromEntries(Object.entries(globales).filter(([, v]) => v.trim() !== '')),
      politica: pol,
      resoluciones: resol,
      repetidas:    rep,
    }
    setCargando(true)
    const ld = toastLoading('Validando…')
    const acc = {
      total, ok: 0, errores: 0, por_decidir: 0, nuevos: 0, actualizar: 0, saltar: 0,
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
      acc.nuevos += t.nuevos; acc.actualizar += t.actualizar; acc.saltar += t.saltar
      acc.filas.push(...t.filas.filter(f => !f.ok))
      acc.resumen    = fusionarTotales(acc.resumen, t.resumen ?? [])
      acc.pendientes = fusionarPendientes(acc.pendientes, t.pendientes ?? [])
      acc.repetidas.push(...(t.repetidas ?? []))
      claves = t.claves
      desde  = t.siguiente
      setProgreso(desde === null ? null : { hechas: desde, total: t.total })
    }
    await ld.dismiss()
    setCargando(false)
    setResoluciones({
      ...Object.fromEntries(acc.pendientes
        .filter(p => !p.decidir)
        .map(p => [p.clave, { accion: p.defecto } as Resolucion])),
      ...resol,
    })
    setSinAplicar([]); setRepetidasAplicadas(rep)
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
      if (res.auxiliares) aux = res.auxiliares
      claves = t.claves
      desde  = t.siguiente
      setProgreso(desde === null ? null : { hechas: desde, total: resultado?.total ?? total })
    }
    await ld.dismiss()
    setCargando(false)
    setResumen(acc); setAuxiliares(aux); setPaso('hecho')
  }

  const malas = resultado?.filas.filter(f => !f.decidir) ?? []
  const erroresAgrupados = agruparPorMotivo(malas)
  const urgentes = resultado?.pendientes.filter(p => p.decidir) ?? []
  const deOficio = resultado?.pendientes.filter(p => !p.decidir) ?? []
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
    setDeshecho(null); setAvisos([]); setProgreso(null); setPlantillaBajada(false)
    setResoluciones({}); setAuxiliares([])
  }

  const etiquetaProgreso = progreso ? `${progreso.hechas} de ${progreso.total}` : ''
  const etiquetaEntidad = etiquetaEnt || 'filas'

  return (
    <div className="view-container">
      <div className="page-header">
        <div>
          <h1 className="page-title">Importar datos</h1>
          <p className="page-subtitle">Sube tus datos desde un archivo Excel o CSV. Nada se guarda hasta que lo confirmes, y puedes deshacerlo.</p>
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
          <div className="alert alert-info alert-intro">
            Elige qué información vas a subir. Empieza por lo de arriba (clientes, catálogo): lo de
            abajo (stock, saldos, histórico) se apoya en ello, así que conviene importarlo después.
          </div>
          {entidades.length === 0 ? (
            <p className="modal-body-text">No hay nada que puedas importar ahora mismo. Consulta con tu administrador.</p>
          ) : (
            <div className="imprt-entidad-grid">
              {entidades.map(en => (
                <button key={en.entidad} type="button" className="imprt-entidad"
                  disabled={cargando} onClick={() => elegirEntidad(en)}>
                  <strong>{en.etiqueta}</strong>
                  <span>{META[en.entidad]?.desc ?? 'Sube tus datos de esta sección.'}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Paso 2: plantilla + subir (plantilla obligatoria) ── */}
      {paso === 'subir' && (
        <div className="card">
          <div className="alert alert-info alert-intro">
            <strong>Cómo funciona:</strong> 1) descarga la plantilla de «{etiquetaEnt.toLowerCase()}»,
            2) rellénala con tus datos (una fila por cada uno), 3) súbela aquí. En Excel (.xlsx) los
            acentos y los decimales llegan siempre bien; en CSV dependen de la codificación.
          </div>
          {corte && (
            <div className="alert alert-warning">
              <AlertTriangle size={16} strokeWidth={2} />
              <div>
                <strong className="alert-titulo">{corte.titulo}</strong>
                {corte.cuerpo}
              </div>
            </div>
          )}
          <div className="ter-form-grid">
            <div className="input-group ter-col-span-3">
              <label>Paso 1 · Descarga la plantilla <span className="required">*</span></label>
              <div className="imprt-plantilla-botones">
                <button type="button" className="btn btn-secondary" onClick={descargarPlantillaExcel} disabled={bajandoPlantilla}>
                  <Download size={15} strokeWidth={2} /> {bajandoPlantilla ? 'Generando…' : 'Descargar plantilla Excel'}
                </button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={descargarPlantillaCsv} disabled={bajandoPlantilla}>
                  o en CSV
                </button>
              </div>
              <span className="input-hint">
                Las columnas con <span className="required">*</span> son obligatorias; la fila de
                ejemplo se puede dejar, no se importa. {plantillaBajada
                  ? 'Ya la tienes: rellénala y súbela abajo.'
                  : 'Descárgala para poder subir tu archivo.'}
              </span>
            </div>
            <div className="input-group ter-col-span-3">
              <label htmlFor="imprt-enc">Codificación (solo CSV)</label>
              <select id="imprt-enc" className="input" value={encoding} onChange={e => setEncoding(e.target.value)}>
                <option value="UTF-8">UTF-8 (recomendado)</option>
                <option value="windows-1252">Windows-1252 (Excel en español)</option>
              </select>
            </div>
          </div>

          <label className="input-group">
            <span className="label-text">Paso 2 · Sube tu archivo relleno</span>
          </label>
          <input ref={fileRef} type="file" accept=".csv,.xlsx,text/csv" className="imprt-drop-input"
            onChange={onElegir} disabled={cargando || !plantillaBajada} aria-label="Elegir archivo" />
          <button type="button" className={`imprt-drop ${arrastrando ? 'imprt-drop-activa' : ''}`}
            onClick={() => { if (plantillaBajada) fileRef.current?.click() }} disabled={cargando || !plantillaBajada}
            onDragOver={e => { e.preventDefault(); if (plantillaBajada) setArrastrando(true) }}
            onDragLeave={() => setArrastrando(false)}
            onDrop={onSoltar}>
            {!plantillaBajada
              ? <><Lock size={32} strokeWidth={1.5} />
                  <strong>Descarga primero la plantilla</strong>
                  <span>El botón de subir se activa en cuanto descargues la plantilla de arriba.</span></>
              : cargando
                ? <><FileSpreadsheet size={32} strokeWidth={1.5} /><strong>Leyendo el archivo…</strong></>
                : <><FileSpreadsheet size={32} strokeWidth={1.5} />
                    <strong>Elige un archivo o arrástralo aquí</strong>
                    <span>CSV o Excel (.xlsx) de {etiquetaEnt.toLowerCase()}. Las columnas se detectan solas.</span></>}
          </button>
          <div className="imprt-acciones">
            <button type="button" className="btn btn-ghost" onClick={() => setPaso('entidad')}>
              <ArrowLeft size={15} strokeWidth={2} /> Atrás
            </button>
          </div>
        </div>
      )}

      {/* ── Paso 3: mapear (sin guardar plantilla de mapeo) ── */}
      {paso === 'mapear' && (
        <div className="card">
          <div className="alert alert-info alert-intro">
            Empareja cada dato de CLAUX con una columna de tu archivo. Si usaste nuestra plantilla,
            ya viene emparejado: solo revísalo. Elige también qué hacer si un dato ya existe.
          </div>
          <p className="modal-body-text">Se detectaron <strong>{total}</strong> filas.</p>

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
                ? <><span className="spinner spinner-sm" /> Comprobando {etiquetaProgreso}…</>
                : <>Comprobar <ArrowRight size={15} strokeWidth={2} /></>}
            </button>
          </div>
        </div>
      )}

      {/* ── Paso 4: revisar (dry-run) ── */}
      {paso === 'validar' && resultado && (
        <div className="imprt-revisar">
          <div className="alert alert-info alert-intro">
            Esto es una comprobación: <strong>nada se ha guardado todavía</strong>. Revisa los totales
            y responde lo que te preguntemos. Se escribe solo cuando pulses «Importar», y podrás deshacerlo.
          </div>
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

          {resultado.repetidas.length > 0 && (
            <PanelRepetidas
              repetidas={resultado.repetidas}
              decision={repetidas}
              sinAplicar={repetidasSinAplicar}
              onDecidir={setRepetidas}
            />
          )}

          {resultado.resumen.length > 0 && (
            <div className="card">
              <div className="card-header">
                <h2 className="card-title card-title-sm">Totales</h2>
                <span className="text-xs-muted">Comprueba que son los que esperas</span>
              </div>
              <div className="imprt-tiles">
                {resultado.resumen.map(t => (
                  <div key={t.etiqueta} className="imprt-tile">
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
              {corte && (
                <li>
                  <AlertTriangle size={14} strokeWidth={2} />
                  <span>Esto es lo <strong>anterior</strong> a tu fecha de corte. A partir de ahí, registra en vivo y no vuelvas a subir este período, o contará dos veces.</span>
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
                <button type="button" className="btn btn-primary" onClick={aplicar} disabled={cargando || (resultado.nuevos + resultado.actualizar) === 0}>
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
          <div className="alert alert-success"><CheckCircle2 size={16} strokeWidth={2} /> Importación completada.</div>
          <div className="imprt-tiles">
            <div className="imprt-tile"><strong>{resumen.insertadas}</strong><span>Creadas</span></div>
            <div className="imprt-tile"><strong>{resumen.actualizadas}</strong><span>Actualizadas</span></div>
            <div className="imprt-tile"><strong>{resumen.saltadas}</strong><span>Saltadas</span></div>
            <div className="imprt-tile"><strong>{resumen.errores}</strong><span>Con error</span></div>
          </div>

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

      {/* Banner de ayuda: siempre visible, para pedir que lo haga el equipo. */}
      <BannerAyuda />

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
