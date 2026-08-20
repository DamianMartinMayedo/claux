'use client'

import { Fragment, useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { toastError, toastLoading, toastSuccess, toastWarning } from '@/app/contexts/ToastContext'
import {
  confirmarNomina, eliminarNomina, exportarNominaXlsx, obtenerRecibosNomina,
  guardarIncidenciaDeLinea, guardarDevengadoDeLinea,
  type NominaDetalleData, type NominaLinea, type ItemLinea,
} from '@/app/actions/portal/rrhh'
import {
  ConfirmarNominaModal, actualizarConceptosNominas, formatMonto, formatPeriodo,
} from '../../_shared/NominaDetalleModal'
import { etiquetaEnTabla } from '@/lib/rrhh/conceptos'
import { useConfigurador } from '@/components/portal/ConfiguradorContext'
import { ConfirmDialog } from '@/components/portal/Dialog'
import { RowActions } from '@/components/portal/RowActions'
import { descargarBase64, XLSX_MIME } from '@/lib/exportar/descargar'
import { costeEmpresa } from '@/lib/rrhh/coste'
import {
  ChevronDown, CircleCheck, DollarSign, Download, FileText, Plus, RefreshCw, Trash2, X,
} from 'lucide-react'

// ── Lo variable del mes, en el cliente ──────────────────────────────────────────
// Mismos campos que `IncidenciaMes` (rrhh.ts), pero sin depender de su forma
// exacta aquí: un empleado sin incidencia guardada usa esta plantilla vacía.

interface IncidenciaEditable {
  dias_trabajados:  number | null
  dias_vacaciones:  number
  dias_liquidacion: number
  pago_extra:       number
  pago_nocturnidad: number
  feriados:         number
  penalizacion:     number
  otros_descuentos: number
  pago_subsidios:   number
}

const INCIDENCIA_VACIA: IncidenciaEditable = {
  dias_trabajados: null, dias_vacaciones: 0, dias_liquidacion: 0, pago_extra: 0,
  pago_nocturnidad: 0, feriados: 0, penalizacion: 0, otros_descuentos: 0, pago_subsidios: 0,
}

/** Los seis campos en dinero que solo aparecen si alguien los usa este mes. */
const CAMPOS_DISPERSOS: { campo: keyof IncidenciaEditable; etiqueta: string }[] = [
  { campo: 'pago_extra',       etiqueta: 'Pago extra' },
  { campo: 'pago_nocturnidad', etiqueta: 'Nocturnidad' },
  { campo: 'feriados',         etiqueta: 'Feriados' },
  { campo: 'penalizacion',     etiqueta: 'Penalización' },
  { campo: 'otros_descuentos', etiqueta: 'Otros descuentos' },
  { campo: 'pago_subsidios',   etiqueta: 'Subsidios' },
]

/**
 * Lee una celda de días y NO la deja en blanco: si se borra, se repone el valor por
 * defecto (los días laborables del trabajador, o 0 en vacaciones) y se devuelve ese
 * número. Una celda vacía escondía el dato con el que se está calculando de verdad.
 */
function rellenar(input: HTMLInputElement, porDefecto: number): number {
  const t = input.value.trim()
  const n = t ? parseFloat(t) : NaN
  if (isNaN(n)) { input.value = String(porDefecto); return porDefecto }
  return n
}
function num(v: string): number {
  const n = parseFloat(v)
  return isNaN(n) ? 0 : n
}

// ── Desglose fiscal de una línea, plegado ───────────────────────────────────────
// Lo que antes se enseñaba siempre en línea (`DesgloseLinea`); aquí solo al
// desplegar, para que la tabla quepa con 50 filas. El coste de empresa
// (APORTE_EMPRESA) va aparte: no resta del neto del trabajador, mezclarlo con
// las retenciones en el mismo signo sería decir que sí.
//
// Los cinco tributos se abrevian AQUÍ y solo aquí (`etiquetaEnTabla`, por clave y no
// por nombre): en el desglose de una plantilla entera no caben cinco nombres fiscales
// completos. El recibo en PDF y el Excel siguen con el nombre entero.

function DesgloseFila({ items, colSpan }: { items: ItemLinea[]; colSpan: number }) {
  const propios  = items.filter(i => i.tipo !== 'APORTE_EMPRESA' && i.monto > 0.005)
  const empresa  = items.filter(i => i.tipo === 'APORTE_EMPRESA' && i.monto > 0.005)
  return (
    <tr className="nom-tabla-desglose-fila">
      <td colSpan={colSpan}>
        <div className="nom-desglose">
          {propios.length === 0 && empresa.length === 0 && (
            <span className="nom-desglose-vacio">Solo el salario del período</span>
          )}
          {propios.map((it, i) => (
            <span key={it.item_id ?? i} className="nom-desglose-item">
              <span className={`nom-desglose-monto ${it.tipo === 'DEVENGO' ? 'nom-desglose-mas' : 'nom-desglose-menos'}`}>
                {it.tipo === 'DEVENGO' ? '+' : '−'}{formatMonto(it.monto)}
              </span>
              <span>{etiquetaEnTabla(it.clave, it.nombre)}</span>
            </span>
          ))}
          {empresa.map((it, i) => (
            <span key={it.item_id ?? `ae-${i}`} className="nom-desglose-item">
              <span className="nom-desglose-monto text-xs-muted">+{formatMonto(it.monto)}</span>
              <span className="text-xs-muted">{etiquetaEnTabla(it.clave, it.nombre)} (coste de empresa, no reduce su neto)</span>
            </span>
          ))}
        </div>
      </td>
    </tr>
  )
}

// ── Modal: agregar una incidencia rara para un trabajador ───────────────────────

function AgregarIncidenciaModal({
  lineas, valores, moneda, onClose, onGuardar, isPending,
}: {
  lineas:     NominaLinea[]
  valores:    Record<string, IncidenciaEditable>
  moneda:     string
  onClose:    () => void
  /** Todos los campos de una vez: un guardado, un recálculo. */
  onGuardar:  (empleado_id: string, cambios: Partial<IncidenciaEditable>) => void
  isPending:  boolean
}) {
  const [empleadoId, setEmpleadoId] = useState(lineas[0]?.empleado_id ?? '')
  // Los seis campos a la vez, no uno por vuelta de modal: un pago extra y una
  // nocturnidad para la misma persona eran dos aperturas, dos guardados y dos
  // recálculos de su línea.
  const vacio = () => Object.fromEntries(CAMPOS_DISPERSOS.map(c => [c.campo, ''])) as Record<string, string>
  const desde = (id: string) => Object.fromEntries(
    CAMPOS_DISPERSOS.map(c => [c.campo, String(valores[id]?.[c.campo] || '')])) as Record<string, string>
  const [campos, setCampos] = useState<Record<string, string>>(() =>
    empleadoId ? desde(empleadoId) : vacio())

  function cambiarEmpleado(id: string) {
    setEmpleadoId(id)
    setCampos(desde(id))
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const cambios: Partial<IncidenciaEditable> = {}
    for (const c of CAMPOS_DISPERSOS) cambios[c.campo] = num(campos[c.campo] ?? '') as never
    onGuardar(empleadoId, cambios)
  }

  return (
    <div className="modal-backdrop open dialog-top">
      <div className="modal modal-lg" role="dialog" aria-modal>
        <div className="modal-header">
          <h2 className="modal-title">Incidencias del mes</h2>
          <button type="button" className="modal-close" onClick={onClose}><X size={16} strokeWidth={2} /></button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            <div className="ter-form-grid">
              <div className="input-group ter-col-full">
                <label htmlFor="ai-emp">Trabajador <span className="required">*</span></label>
                <select className="input" id="ai-emp" value={empleadoId} onChange={e => cambiarEmpleado(e.target.value)}>
                  {lineas.map(l => <option key={l.empleado_id} value={l.empleado_id}>{l.empleado_nombre}</option>)}
                </select>
              </div>
              {CAMPOS_DISPERSOS.map(c => (
                <div className="input-group ter-col-span-3" key={c.campo}>
                  <label htmlFor={`ai-${c.campo}`}>{c.etiqueta} ({moneda})</label>
                  <input className="input" id={`ai-${c.campo}`} type="number" min="0" step="any"
                    value={campos[c.campo] ?? ''} placeholder="0"
                    onChange={e => setCampos(p => ({ ...p, [c.campo]: e.target.value }))} />
                </div>
              ))}
            </div>
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancelar</button>
            <button type="submit" className="btn btn-primary" disabled={isPending}>
              {isPending ? <><span className="spinner spinner-sm" /> Guardando…</> : <><Plus size={15} strokeWidth={2} /> Guardar</>}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Vista principal ──────────────────────────────────────────────────────────────

export default function NominaDetalleView({ detalle, tienePermiso }: { detalle: NominaDetalleData; tienePermiso: boolean }) {
  const router = useRouter()
  const esConfigurador = useConfigurador()
  const [isPending, startTransition] = useTransition()
  const { data, nomina, esCuba, diasLaborables, sugerenciaDias, sugerenciaLiquidacion } = detalle
  const { tieneContabilidad } = data

  const esBorrador  = nomina.estado === 'BORRADOR'
  // Bajo impersonación, una CONFIRMADA se puede corregir sin tocar la base a
  // mano; en sesión normal, una vez confirmada es de solo lectura. Y en todos los
  // casos exige permiso de edición del módulo: sin él (solo-lectura o sin acceso a
  // RRHH) no se pinta ningún control de escritura, ni siquiera en un borrador.
  const puedeEditar = tienePermiso && (esBorrador || esConfigurador)

  const [incidencias, setIncidencias] = useState<Record<string, IncidenciaEditable>>(() => {
    const out: Record<string, IncidenciaEditable> = {}
    for (const l of nomina.lineas) {
      const i = detalle.incidencias[l.empleado_id]
      out[l.empleado_id] = i ? { ...INCIDENCIA_VACIA, ...i } : { ...INCIDENCIA_VACIA }
    }
    return out
  })
  const [guardando, setGuardando] = useState<string | null>(null)
  const [expandido, setExpandido] = useState<string | null>(null)
  const [modalAgregar, setModalAgregar] = useState(false)
  const [confirmarNom, setConfirmarNom] = useState(false)
  const [confirmarEliminar, setConfirmarEliminar] = useState(false)
  const [exportando, setExportando] = useState(false)
  const [recibosPend, setRecibosPend] = useState(false)

  // Reglas/conceptos del negocio cambiados desde que se generó — distinto de
  // las incidencias: lo marca el servidor por línea (`desfasada`) y se resuelve
  // con el mismo «Reabrir y actualizar» de siempre, disponible para cualquiera
  // con permiso de escritura (no solo bajo impersonación: esto no es corregir
  // un dato del cliente, es aplicar una regla que cambió para todos).
  const desfasadas  = nomina.lineas.filter(l => l.desfasada).length
  const tienePagos  = !esBorrador && nomina.pagado > 0.005

  // Columnas dispersas: solo se pintan si ALGÚN trabajador tiene algo este mes.
  const columnasVisibles = useMemo(() => {
    return CAMPOS_DISPERSOS.filter(c => Object.values(incidencias).some(i => (i[c.campo] || 0) > 0))
  }, [incidencias])

  const totales = useMemo(() => {
    let devengado = 0, retenciones = 0, aportes = 0, neto = 0
    let vacPagadas = 0, vacAcumuladas = 0
    for (const l of nomina.lineas) {
      devengado += l.devengado; retenciones += l.deducciones; neto += l.neto
      vacPagadas    += l.vacaciones_pagadas_periodo
      vacAcumuladas += l.vacaciones_acumuladas_periodo
      for (const it of l.items) if (it.tipo === 'APORTE_EMPRESA') aportes += it.monto
    }
    // El número que el dueño busca antes de confirmar: lo que le CUESTA. Misma fórmula
    // que el recibo, y ahora literalmente la misma función (`lib/rrhh/coste.ts`).
    return {
      devengado, retenciones, aportes, neto, vacAcumuladas,
      coste: costeEmpresa({
        devengado, aportes,
        vacaciones_pagadas:    vacPagadas,
        vacaciones_acumuladas: vacAcumuladas,
      }),
    }
  }, [nomina.lineas])

  const colSpanFila = 5 + (esCuba ? 2 : 0) + columnasVisibles.length + 1

  // ── Días sugeridos ─────────────────────────────────────────────────────────────
  // Se filtran contra el estado LOCAL, no solo contra lo que trajo el servidor: si el
  // dueño acaba de teclear esos días a mano, la propuesta ya no tiene nada que decir.
  const sugerenciasVisibles = useMemo(
    () => Object.entries(sugerenciaDias).filter(([id, s]) => {
      const actual = incidencias[id]?.dias_trabajados ?? diasLaborables[id] ?? 0
      return Math.abs(actual - s.dias) >= 0.05
    }),
    [sugerenciaDias, incidencias, diasLaborables],
  )
  const nombreCorto = (empleadoId: string) => {
    const l = nomina.lineas.find(x => x.empleado_id === empleadoId)
    return l ? l.empleado_nombre.split(' ')[0] : '—'
  }
  /** Aplica los días propuestos, uno por uno y por el camino que ya existe: cada
   *  guardado recalcula SU línea (`guardarIncidenciaDeLinea`). No hay lógica de
   *  escritura nueva, y el dueño puede corregir cualquiera después. */
  function aplicarSugerencias() {
    const pend = sugerenciasVisibles
    if (!pend.length) return
    const ld = toastLoading(`Aplicando los días de ${pend.length} ${pend.length === 1 ? 'trabajador' : 'trabajadores'}…`)
    startTransition(async () => {
      let hechas = 0
      const fallos: string[] = []
      // En serie: cada una recalcula su línea y reescribe el total de la nómina, y
      // varias a la vez se pisarían.
      for (const [empleadoId, s] of pend) {
        const previa = incidencias[empleadoId] ?? INCIDENCIA_VACIA
        const fd = new FormData()
        fd.set('nomina_id',   nomina.nomina_id)
        fd.set('empleado_id', empleadoId)
        fd.set('periodo',     nomina.periodo)
        fd.set('dias_trabajados',  String(s.dias))
        fd.set('dias_vacaciones',  String(previa.dias_vacaciones))
        fd.set('dias_liquidacion', String(previa.dias_liquidacion))
        fd.set('pago_extra',       String(previa.pago_extra))
        fd.set('pago_nocturnidad', String(previa.pago_nocturnidad))
        fd.set('feriados',         String(previa.feriados))
        fd.set('penalizacion',     String(previa.penalizacion))
        fd.set('otros_descuentos', String(previa.otros_descuentos))
        fd.set('pago_subsidios',   String(previa.pago_subsidios))
        const res = await guardarIncidenciaDeLinea(fd)
        if (res.ok) hechas++
        else fallos.push(`${nombreCorto(empleadoId)}: ${res.error ?? 'error'}`)
      }
      await ld.dismiss()
      if (hechas) toastSuccess(hechas === 1 ? 'Días aplicados · línea recalculada' : `Días aplicados a ${hechas} trabajadores`)
      if (fallos.length) toastError(fallos.join(' · '))
      router.refresh()
    })
  }

  // ── Liquidación de vacaciones al causar baja ───────────────────────────────────
  // Igual que los días sugeridos, pero para el saldo pendiente de quien se va: solo
  // sale si el servidor lo propone y la línea no lo liquida ya en local.
  const liquidacionesVisibles = useMemo(
    () => Object.entries(sugerenciaLiquidacion).filter(([id]) =>
      (incidencias[id]?.dias_liquidacion ?? 0) < 0.05),
    [sugerenciaLiquidacion, incidencias],
  )
  /** Rellena `dias_liquidacion` con el saldo propuesto, uno por uno y por el mismo
   *  camino que ya recalcula la línea. El dueño puede corregirlo después. */
  function aplicarLiquidaciones() {
    const pend = liquidacionesVisibles
    if (!pend.length) return
    const ld = toastLoading(`Liquidando a ${pend.length} ${pend.length === 1 ? 'trabajador' : 'trabajadores'}…`)
    startTransition(async () => {
      let hechas = 0
      const fallos: string[] = []
      for (const [empleadoId, s] of pend) {
        const previa = incidencias[empleadoId] ?? INCIDENCIA_VACIA
        const fd = new FormData()
        fd.set('nomina_id',   nomina.nomina_id)
        fd.set('empleado_id', empleadoId)
        fd.set('periodo',     nomina.periodo)
        fd.set('dias_trabajados',  previa.dias_trabajados === null ? '' : String(previa.dias_trabajados))
        fd.set('dias_vacaciones',  String(previa.dias_vacaciones))
        fd.set('dias_liquidacion', String(s.dias))
        fd.set('pago_extra',       String(previa.pago_extra))
        fd.set('pago_nocturnidad', String(previa.pago_nocturnidad))
        fd.set('feriados',         String(previa.feriados))
        fd.set('penalizacion',     String(previa.penalizacion))
        fd.set('otros_descuentos', String(previa.otros_descuentos))
        fd.set('pago_subsidios',   String(previa.pago_subsidios))
        const res = await guardarIncidenciaDeLinea(fd)
        if (res.ok) hechas++
        else fallos.push(`${nombreCorto(empleadoId)}: ${res.error ?? 'error'}`)
      }
      await ld.dismiss()
      if (hechas) toastSuccess(hechas === 1 ? 'Vacaciones liquidadas · línea recalculada' : `Liquidadas a ${hechas} trabajadores`)
      if (fallos.length) toastError(fallos.join(' · '))
      router.refresh()
    })
  }

  /** Escribe uno o varios campos de la incidencia de un trabajador y recalcula SU línea. */
  function guardarCampo(
    empleado_id: string,
    campo: keyof IncidenciaEditable | Partial<IncidenciaEditable>,
    valor?: number | null,
  ) {
    const previa = incidencias[empleado_id] ?? INCIDENCIA_VACIA
    const nueva  = typeof campo === 'string'
      ? { ...previa, [campo]: valor }
      : { ...previa, ...campo }
    setIncidencias(prev => ({ ...prev, [empleado_id]: nueva }))

    const fd = new FormData()
    fd.set('nomina_id',   nomina.nomina_id)
    fd.set('empleado_id', empleado_id)
    fd.set('periodo',     nomina.periodo)
    fd.set('dias_trabajados',  nueva.dias_trabajados === null ? '' : String(nueva.dias_trabajados))
    fd.set('dias_vacaciones',  String(nueva.dias_vacaciones))
    fd.set('dias_liquidacion', String(nueva.dias_liquidacion))
    fd.set('pago_extra',       String(nueva.pago_extra))
    fd.set('pago_nocturnidad', String(nueva.pago_nocturnidad))
    fd.set('feriados',         String(nueva.feriados))
    fd.set('penalizacion',     String(nueva.penalizacion))
    fd.set('otros_descuentos', String(nueva.otros_descuentos))
    fd.set('pago_subsidios',   String(nueva.pago_subsidios))

    setGuardando(empleado_id)
    // El toast de carga se crea FUERA de la transición: dentro no llega a pintarse,
    // y en una conexión lenta la celda parece que no hizo nada.
    const ld = toastLoading('Guardando y recalculando…')
    startTransition(async () => {
      const res = await guardarIncidenciaDeLinea(fd)
      await ld.dismiss()
      setGuardando(null)
      if (!res.ok) { toastError(res.error ?? 'Error inesperado.'); return }
      toastSuccess('Guardado · línea recalculada')
      if (res.aviso) toastWarning(res.aviso)
      if (res.reabierta) toastWarning('Se reabrió la nómina para aplicar tu corrección: revísala y vuelve a confirmarla.')
      setModalAgregar(false)
      router.refresh()
    })
  }

  function guardarDevengado(linea: NominaLinea, valor: string) {
    const fd = new FormData()
    fd.set('linea_id', linea.linea_id)
    fd.set('devengado', valor)
    setGuardando(linea.empleado_id)
    const ld = toastLoading('Guardando…')
    startTransition(async () => {
      const res = await guardarDevengadoDeLinea(fd)
      await ld.dismiss()
      setGuardando(null)
      if (!res.ok) { toastError(res.error ?? 'Error inesperado.'); return }
      toastSuccess('Guardado · línea recalculada')
      if (res.reabierta) toastWarning('Se reabrió la nómina para aplicar tu corrección: revísala y vuelve a confirmarla.')
      router.refresh()
    })
  }

  function doConfirmar() {
    const ld = toastLoading('Confirmando…')
    startTransition(async () => {
      const res = await confirmarNomina(nomina.nomina_id)
      await ld.dismiss()
      if (!res.ok) { toastError(res.error ?? 'Error inesperado.'); return }
      setConfirmarNom(false); router.refresh()
    })
  }

  function doEliminar() {
    const ld = toastLoading('Eliminando…')
    startTransition(async () => {
      const res = await eliminarNomina(nomina.nomina_id)
      await ld.dismiss()
      if (!res.ok) { toastError(res.error ?? 'Error inesperado.'); setConfirmarEliminar(false); return }
      router.push('/portal/nomina')
    })
  }

  /**
   * Los recibos de toda la plantilla. VA FUERA de `startTransition` a propósito, como
   * el de la ficha: dentro, el toast de carga no llega a pintarse, y con 39 recibos
   * este paso tarda lo suficiente para que el usuario crea que no hizo nada.
   *
   * Con MÁS de uno van en un solo ZIP: 39 descargas sueltas o las bloquea el navegador
   * o el usuario no sabe dónde acaban. Con uno solo, el PDF directo, sin envolverlo.
   */
  async function descargarRecibos() {
    if (recibosPend) return
    setRecibosPend(true)
    const ld = toastLoading('Generando los recibos…')
    try {
      const res = await obtenerRecibosNomina(nomina.nomina_id)
      if (!res.ok) { toastError(res.error); return }
      if (res.recibos.length === 0) { toastError('No hay recibos que descargar.'); return }
      const nombreDe = (n: string) => n.split(' ').slice(0, 2).join('-').toLowerCase()

      if (res.recibos.length === 1) {
        const { descargarReciboNomina } = await import('@/lib/pdf/recibo-nomina')
        const r = res.recibos[0]
        await descargarReciboNomina(r.recibo, `recibo-${nombreDe(r.nombre)}-${nomina.periodo}.pdf`)
        toastSuccess('Recibo descargado')
        return
      }

      const [{ blobReciboNomina }, JSZipMod] = await Promise.all([
        import('@/lib/pdf/recibo-nomina'),
        import('jszip'),
      ])
      const zip = new JSZipMod.default()
      // Un mismo nombre corto podría repetirse (dos «Juan Pérez»): se numera el choque
      // para que ningún recibo pise a otro dentro del ZIP.
      const usados = new Map<string, number>()
      for (const r of res.recibos) {
        const base = `recibo-${nombreDe(r.nombre)}-${nomina.periodo}`
        const n = (usados.get(base) ?? 0) + 1
        usados.set(base, n)
        const nombre = n === 1 ? `${base}.pdf` : `${base}-${n}.pdf`
        zip.file(nombre, await blobReciboNomina(r.recibo))
      }
      const contenido = await zip.generateAsync({ type: 'blob' })
      const url = URL.createObjectURL(contenido)
      const a = document.createElement('a')
      a.href = url
      a.download = `recibos-${nomina.periodo}.zip`
      a.click()
      URL.revokeObjectURL(url)
      toastSuccess(`${res.recibos.length} recibos en un ZIP`)
    } catch {
      toastError('No se pudieron generar los recibos.')
    } finally {
      await ld.dismiss()
      setRecibosPend(false)
    }
  }

  function exportar() {
    setExportando(true)
    const ld = toastLoading('Preparando el Excel…')
    startTransition(async () => {
      const res = await exportarNominaXlsx(nomina.nomina_id)
      await ld.dismiss()
      setExportando(false)
      if (!res.ok || !res.base64) { toastError(res.error ?? 'No se pudo exportar.'); return }
      descargarBase64(res.nombre ?? 'nomina.xlsx', res.base64, XLSX_MIME)
      toastSuccess('Excel descargado')
    })
  }

  return (
    <div className="view-container">
      <div className="breadcrumb">
        <Link href="/portal/nomina">Nómina</Link>
        <span>›</span>
        <span className="breadcrumb-current">{formatPeriodo(nomina.periodo)}</span>
      </div>

      <div className="det-page-header">
        <div>
          <div className="det-title-group">
            <h1 className="det-page-title">Nómina {formatPeriodo(nomina.periodo)}</h1>
            <span className={`badge ${esBorrador ? 'badge-warning' : 'badge-success'}`}>
              {esBorrador ? 'Borrador' : 'Confirmada'}
            </span>
          </div>
          <div className="det-meta-row">
            <span>{data.empresa_nombres[nomina.empresa_id] ?? '—'}</span>
            <span>{nomina.moneda}</span>
            {/* Confirmar ya generó todas las deudas de esta nómina, así que el pago se
                hace desde Tesorería como cualquier otra: aquí solo se informa de si el
                salario neto está pagado, y se enlaza a donde se paga. «Pagada» mira solo
                el salario neto a propósito — los impuestos tienen otro calendario. */}
            {/* Sin Contabilidad no hay Tesorería donde liquidar, así que este estado no
                se puede apagar nunca: enseñarlo sería un «pendiente» perpetuo por una
                deuda que ese cliente no tiene forma de pagar en CLAUX. */}
            {!esBorrador && tieneContabilidad && (nomina.saldo_pendiente > 0.005
              ? <span>Salario pendiente de pago: <strong>{formatMonto(nomina.saldo_pendiente)} {nomina.moneda}</strong></span>
              : <span>Salario pagado</span>)}
          </div>
        </div>
        <div className="det-actions">
          {/* Los recibos, de una vez. Antes solo se bajaban desde la ficha de cada
              trabajador: para 39 personas eran 39 navegaciones. */}
          <button className="btn btn-secondary" onClick={descargarRecibos} disabled={recibosPend || exportando}>
            <FileText size={14} strokeWidth={2} /> {recibosPend ? 'Generando recibos…' : 'Descargar recibos'}
          </button>
          <button className="btn btn-secondary" onClick={exportar} disabled={exportando}>
            <Download size={14} strokeWidth={2} /> Exportar a Excel
          </button>
          {esBorrador && puedeEditar && (
            <button className="btn btn-primary" onClick={() => setConfirmarNom(true)}>
              <CircleCheck size={15} strokeWidth={2} /> Confirmar nómina
            </button>
          )}
          {/* Fuera el botón «Pagar» (mig. 166): una nómina confirmada genera VARIAS
              deudas —el salario neto y cada retención, cada una con su acreedor y su
              vencimiento— y un solo botón solo podía pagar una de ellas, dando por
              liquidada la nómina entera. Se paga en Tesorería, con el resto. */}
          {!esBorrador && tieneContabilidad && nomina.saldo_pendiente > 0.005 && (
            <Link className="btn btn-primary" href="/portal/cxp">
              <DollarSign size={15} strokeWidth={2} /> Ver en Cuentas por pagar
            </Link>
          )}
          {puedeEditar && (
            <RowActions>
              <button className="row-actions-item row-actions-item-danger" onClick={() => setConfirmarEliminar(true)}>
                <Trash2 size={14} strokeWidth={2} /> Eliminar
              </button>
            </RowActions>
          )}
        </div>
      </div>

      {!esBorrador && !esConfigurador && (
        <div className="alert alert-info alert-intro">
          Nómina confirmada: de solo lectura. Un desajuste se corrige desde el modo de configuración.
        </div>
      )}

      {desfasadas > 0 && (
        <div className="alert alert-warning alert-cta">
          <span className="alert-cta-texto">
            {desfasadas === 1
              ? 'Un trabajador tiene conceptos sin aplicar en esta nómina.'
              : `${desfasadas} trabajadores tienen conceptos sin aplicar en esta nómina.`}
            {tienePagos && ' Para actualizarla hay que reabrirla, y ya tiene pagos registrados: anúlalos en Tesorería primero.'}
          </span>
          {!tienePagos && (
            <button type="button" className="btn btn-aviso btn-sm" disabled={isPending}
                    onClick={() => actualizarConceptosNominas([nomina], undefined, startTransition, () => router.refresh())}>
              <RefreshCw size={14} strokeWidth={2} />
              {esBorrador ? ' Actualizar con los conceptos' : ' Reabrir y actualizar'}
            </button>
          )}
        </div>
      )}

      {/* ── Los días que le tocaban a cada uno ────────────────────────────────────
          `crearNomina` mete a propósito a quien trabajó solo parte del mes, pero deja
          los días en blanco, que el motor lee como MES COMPLETO: quien entró el 20 o
          causó baja el 5 cobraba el mes entero, con todo su bloque fiscal inflado.
          Aquí el sistema PROPONE —desde su alta/baja o desde su semana tipo— y el dueño
          acepta o teclea otra cosa. Solo sale si hay algo que proponer. */}
      {puedeEditar && sugerenciasVisibles.length > 0 && (
        <div className="alert alert-warning alert-cta">
          <span className="alert-cta-texto">
            <strong>
              {sugerenciasVisibles.length === 1
                ? 'Un trabajador no trabajó el mes completo'
                : `${sugerenciasVisibles.length} trabajadores no trabajaron el mes completo`}
              {' '}y la nómina se los paga entero.
            </strong>{' '}
            {sugerenciasVisibles.slice(0, 3)
              .map(([id, s]) => `${nombreCorto(id)}: ${s.dias} días`).join(' · ')}
            {sugerenciasVisibles.length > 3 && ` · y ${sugerenciasVisibles.length - 3} más`}
          </span>
          <button type="button" className="btn btn-aviso btn-sm" disabled={isPending}
            onClick={aplicarSugerencias}>
            <RefreshCw size={14} strokeWidth={2} /> Poner los días sugeridos
          </button>
        </div>
      )}

      {/* ── Liquidar el saldo de quien causa baja ─────────────────────────────────
          Al irse un trabajador, el saldo de vacaciones pendiente se paga de golpe.
          El sistema PROPONE el saldo derivado (excluida esta nómina) y el dueño lo
          acepta o teclea otra cosa en «Días a liquidar». Solo cubano y solo baja. */}
      {puedeEditar && liquidacionesVisibles.length > 0 && (
        <div className="alert alert-warning alert-cta">
          <span className="alert-cta-texto">
            <strong>
              {liquidacionesVisibles.length === 1
                ? 'Un trabajador causa baja este mes'
                : `${liquidacionesVisibles.length} trabajadores causan baja este mes`}
              {' '}con vacaciones sin liquidar.
            </strong>{' '}
            {liquidacionesVisibles.slice(0, 3)
              .map(([id, s]) => `${nombreCorto(id)}: ${s.dias} días (${formatMonto(s.importe)} ${nomina.moneda})`).join(' · ')}
            {liquidacionesVisibles.length > 3 && ` · y ${liquidacionesVisibles.length - 3} más`}
          </span>
          <button type="button" className="btn btn-aviso btn-sm" disabled={isPending}
            onClick={aplicarLiquidaciones}>
            <RefreshCw size={14} strokeWidth={2} /> Liquidar el saldo pendiente
          </button>
        </div>
      )}

      <div className="imprt-tiles mb-3">
        <div className="imprt-tile"><strong>{formatMonto(totales.devengado)}</strong><span>Total devengado</span></div>
        <div className="imprt-tile"><strong>{formatMonto(totales.retenciones)}</strong><span>Retenciones al personal</span></div>
        {esCuba && (
          <div className="imprt-tile"><strong>{formatMonto(totales.aportes)}</strong><span>Aportes de empresa (IUFT+SS)</span></div>
        )}
        {esCuba && totales.vacAcumuladas > 0.005 && (
          <div className="imprt-tile"><strong>{formatMonto(totales.vacAcumuladas)}</strong><span>Vacaciones acumuladas</span></div>
        )}
        <div className="imprt-tile"><strong>{formatMonto(totales.neto)}</strong><span>Neto a pagar</span></div>
        {/* Lo que de verdad le cuesta. Estaba calculado y solo se imprimía en el recibo
            de cada trabajador: la pantalla donde se decide confirmar no lo enseñaba. */}
        {esCuba && (
          <div className="imprt-tile"><strong>{formatMonto(totales.coste)}</strong><span>Coste total para la empresa</span></div>
        )}
      </div>

      {puedeEditar && (
        <div className="ter-toolbar">
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setModalAgregar(true)}>
            <Plus size={14} strokeWidth={2.5} /> Incidencias de un trabajador
          </button>
        </div>
      )}

      <div className="card card-table">
        <div className="table-wrapper">
          <table className="table table-sticky-first">
            <thead>
              <tr>
                <th>Empleado</th>
                <th className="col-num">Salario base</th>
                {esCuba && <th className="col-num">Días trab.</th>}
                {esCuba && <th className="col-num">Días vac.</th>}
                {columnasVisibles.map(c => <th key={c.campo} className="col-num">{c.etiqueta}</th>)}
                <th className="col-num">Devengado</th>
                <th className="col-num">Retenciones</th>
                <th className="col-num">Neto</th>
                <th className="col-actions"></th>
              </tr>
            </thead>
            <tbody>
              {nomina.lineas.map(l => {
                const inc = incidencias[l.empleado_id] ?? INCIDENCIA_VACIA
                const ocupado = guardando === l.empleado_id
                return (
                  <Fragment key={l.linea_id}>
                    <tr>
                      <td data-label="Empleado">
                        {/* El nombre abre la ficha del trabajador en pestaña nueva: se
                            consulta un dato suyo sin perder el borrador que se esté editando. */}
                        <Link href={`/portal/rrhh/${l.empleado_id}`} target="_blank" rel="noopener noreferrer"
                          className="table-name-link cell-clamp" title={`Ver la ficha de ${l.empleado_nombre} (nueva pestaña)`}>
                          {l.empleado_nombre}
                        </Link>
                        {l.cargo && <div className="text-sm-muted">{l.cargo}</div>}
                      </td>
                      <td data-label="Salario base" className="col-num tes-monto-cell">{formatMonto(l.salario_base)}</td>
                      {esCuba && (
                        <td data-label="Días trabajados" className="col-num"
                          /* El porqué, al alcance del cursor: «causó baja el 5 de agosto». */
                          title={sugerenciaDias[l.empleado_id]?.explicacion}>
                          {puedeEditar ? (
                            <input className="input nom-input" type="number" min="0" max="31" step="any"
                              disabled={ocupado}
                              defaultValue={inc.dias_trabajados ?? diasLaborables[l.empleado_id] ?? ''}
                              onBlur={e => guardarCampo(l.empleado_id, 'dias_trabajados',
                                          rellenar(e.currentTarget, diasLaborables[l.empleado_id] ?? 0))}
                              aria-label={`Días trabajados de ${l.empleado_nombre}`} />
                          ) : (inc.dias_trabajados ?? diasLaborables[l.empleado_id] ?? '—')}
                          {sugerenciaDias[l.empleado_id] && (
                            <div className="text-xs-muted">Le tocaban {sugerenciaDias[l.empleado_id].dias}</div>
                          )}
                        </td>
                      )}
                      {esCuba && (
                        <td data-label="Días de vacaciones" className="col-num">
                          {puedeEditar ? (
                            <input className="input nom-input" type="number" min="0" max="31" step="any" disabled={ocupado}
                              defaultValue={inc.dias_vacaciones}
                              onBlur={e => guardarCampo(l.empleado_id, 'dias_vacaciones', rellenar(e.currentTarget, 0))}
                              aria-label={`Días de vacaciones de ${l.empleado_nombre}`} />
                          ) : inc.dias_vacaciones}
                        </td>
                      )}
                      {columnasVisibles.map(c => (
                        <td key={c.campo} data-label={c.etiqueta} className="col-num">
                          {puedeEditar ? (
                            <input className="input nom-input" type="number" min="0" step="any" disabled={ocupado}
                              defaultValue={inc[c.campo] || ''}
                              onBlur={e => guardarCampo(l.empleado_id, c.campo, num(e.target.value))}
                              aria-label={`${c.etiqueta} de ${l.empleado_nombre}`} />
                          ) : (inc[c.campo] || '—')}
                        </td>
                      ))}
                      <td data-label="Devengado" className="col-num">
                        {!esCuba && puedeEditar ? (
                          <input className="input nom-input" type="number" min="0" step="any" disabled={ocupado}
                            defaultValue={l.devengado}
                            onBlur={e => guardarDevengado(l, e.target.value)}
                            aria-label={`Devengado de ${l.empleado_nombre}`} />
                        ) : <span className="tes-monto-cell">{formatMonto(l.devengado)}</span>}
                      </td>
                      <td data-label="Retenciones" className="col-num tes-monto-cell">{formatMonto(l.deducciones)}</td>
                      <td data-label="Neto" className="col-num tes-monto-cell">{formatMonto(l.neto)}</td>
                      <td className="col-actions">
                        <button type="button" className="ter-action-btn" title="Ver desglose"
                          aria-label={`Ver desglose de ${l.empleado_nombre}`}
                          onClick={() => setExpandido(expandido === l.linea_id ? null : l.linea_id)}>
                          <ChevronDown size={15} strokeWidth={2}
                            className={expandido === l.linea_id ? 'nom-chevron-abierto' : undefined} />
                        </button>
                      </td>
                    </tr>
                    {expandido === l.linea_id && <DesgloseFila items={l.items} colSpan={colSpanFila} />}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {modalAgregar && (
        <AgregarIncidenciaModal lineas={nomina.lineas} valores={incidencias} moneda={nomina.moneda}
          onClose={() => setModalAgregar(false)}
          onGuardar={(empleadoId, cambios) => guardarCampo(empleadoId, cambios)}
          isPending={isPending} />
      )}
      {confirmarNom && (
        <ConfirmarNominaModal nomina={nomina} tieneContabilidad={tieneContabilidad}
          onConfirm={doConfirmar}
          onClose={() => setConfirmarNom(false)} isPending={isPending} />
      )}
      {confirmarEliminar && (
        <ConfirmDialog
          title="Eliminar nómina"
          body={`¿Eliminar la nómina de ${formatPeriodo(nomina.periodo)} (${formatMonto(nomina.total)} ${nomina.moneda})? ${nomina.estado === 'CONFIRMADA' ? 'También se revertirán todos los apuntes que generó en tu contabilidad.' : ''}`}
          confirmLabel="Eliminar" danger
          onConfirm={doEliminar}
          onCancel={() => setConfirmarEliminar(false)}
        />
      )}
    </div>
  )
}
