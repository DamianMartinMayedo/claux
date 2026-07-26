'use client'

import { useMemo, useState, useTransition } from 'react'
import { Download, Loader2, BarChart3, Eye } from 'lucide-react'
import { toastError, toastSuccess, toastLoading } from '@/app/contexts/ToastContext'
import {
  estadoDeResultados, notaConversion, congeladoA,
  MODOS_ESTADO, LABEL_MODO_ESTADO, AYUDA_MODO_ESTADO, SUFIJO_MODO_ESTADO,
  type CategoriaMonto, type ModoEstado,
} from '@/lib/dossier/estado'
import { etiquetaMes, type FilaSerie } from '@/lib/dossier/snapshot'
import { guardarModoEstado, type DossierBasico } from '@/app/actions/portal/dossier'
import type { LineaDesglose } from '@/lib/dossier/base'
import DossierDesfase from './DossierDesfase'
import AvisoContabilidad from './AvisoContabilidad'

// El estado de resultados en pantalla ANTES de descargarlo: en Cuba bajar un PDF
// solo para revisarlo cuesta datos (y es lo que ya hace ReportesView). El PDF se
// genera del mismo cálculo puro, así que pantalla y archivo no pueden divergir.
//
// ESTA PESTAÑA ES LA VISTA PREVIA, no un informe interno: lo que se ve aquí es
// exactamente lo que recibe el inversor, en el modo elegido. Por eso el selector
// de modo vive arriba y no en «Lo básico»: se decide MIRANDO el resultado.

const nf = new Intl.NumberFormat('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmt = (n: number) => nf.format(n)
const fmtPct = (n: number) => `${n.toFixed(1).replace('.', ',')} %`

function fechaLarga(f: string | null): string {
  if (!f) return ''
  const [y, m, d] = f.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' })
}

// Normaliza un nombre para el archivo (sin acentos ni símbolos).
function slug(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').toLowerCase() || 'dossier'
}

export default function PestanaEstado({
  dossier, serie, lineas, empresaNombre, simbolo, tieneBase, onRefrescar,
}: {
  dossier: DossierBasico
  serie: FilaSerie[]
  lineas: LineaDesglose[]
  empresaNombre: string
  simbolo: string
  tieneBase: boolean
  onRefrescar?: () => void
}) {
  const er = useMemo(() => estadoDeResultados(serie, lineas), [serie, lineas])
  const nota = useMemo(
    () => notaConversion(dossier.moneda_presentacion, dossier.tasas_usadas, dossier.monedas_faltantes),
    [dossier.moneda_presentacion, dossier.tasas_usadas, dossier.monedas_faltantes],
  )

  const [descargando, setDescargando] = useState(false)
  // Optimista: el selector responde al instante y el servidor confirma. Cambiar de
  // modo es mirar, no comprometerse — esperar a la red para repintar convertiría
  // una comparación en un trámite.
  const [modo, setModo] = useState<ModoEstado>(dossier.estado_modo)
  const [guardando, startGuardar] = useTransition()

  function cambiarModo(nuevo: ModoEstado) {
    if (nuevo === modo) return
    const previo = modo
    setModo(nuevo)
    const ld = toastLoading('Guardando…')
    startGuardar(async () => {
      const fd = new FormData()
      fd.set('dossier_id', dossier.dossier_id)
      fd.set('estado_modo', nuevo)
      const res = await guardarModoEstado(fd)
      await ld.dismiss()
      if (res.ok) { toastSuccess(`Se publicará el estado ${LABEL_MODO_ESTADO[nuevo].toLowerCase()}`); onRefrescar?.() }
      else { setModo(previo); toastError(res.error || 'No se pudo guardar') }
    })
  }

  async function descargar() {
    if (descargando) return
    setDescargando(true)
    try {
      // Import dinámico: jsPDF no entra en el bundle del portal.
      const { descargarEstadoResultados } = await import('@/lib/pdf/dossier')
      // La versión va en el NOMBRE, no solo dentro: quien recibe dos PDF del mismo
      // negocio y período los distingue en la bandeja de entrada, sin abrirlos.
      const archivo = `estado_de_resultados_${slug(SUFIJO_MODO_ESTADO[modo])}_${slug(empresaNombre)}_${dossier.periodo_desde ?? ''}_${dossier.periodo_hasta ?? ''}.pdf`
      await descargarEstadoResultados({
        empresa:      empresaNombre,
        moneda:       dossier.moneda_presentacion,
        periodoDesde: dossier.periodo_desde,
        periodoHasta: dossier.periodo_hasta,
        snapshotAt:   dossier.snapshot_at,
        serie, lineas, modo,
        tasas:        dossier.tasas_usadas,
        faltantes:    dossier.monedas_faltantes,
      }, archivo)
    } catch {
      toastError('No se pudo generar el PDF')
    } finally {
      setDescargando(false)
    }
  }

  if (serie.length === 0) {
    return (
      <div className="card mon-empty">
        <BarChart3 size={40} strokeWidth={1} opacity={0.2} />
        <p>Aún no hay números. Cárgalos en «Mi dossier» y aquí tendrás tu estado de resultados.</p>
      </div>
    )
  }

  const detallar = modo === 'DESGLOSADO'
  const sinDesglose = lineas.length === 0
  const periodo = dossier.periodo_desde && dossier.periodo_hasta
    ? `${fechaLarga(dossier.periodo_desde)} — ${fechaLarga(dossier.periodo_hasta)}`
    : ''

  // Grupo: cabecera + (solo en DESGLOSADO) su detalle por concepto con el peso de
  // cada línea sobre los ingresos.
  const Grupo = ({ titulo, total, pct, cats }: {
    titulo: string; total: number; pct: number | null; cats: CategoriaMonto[]
  }) => (
    <div className="dos-er-bloque">
      <div className="dos-er-linea dos-er-linea-head">
        <span>{titulo}{pct != null && <span className="dos-er-pct"> ({fmtPct(pct)})</span>}</span>
        <strong className="dos-er-monto">{fmt(total)}</strong>
      </div>
      {detallar && (cats.length === 0 ? (
        <div className="dos-er-linea dos-er-sub"><span>Sin desglose por concepto</span><span>—</span></div>
      ) : cats.map(c => (
        <div key={c.concepto} className="dos-er-linea dos-er-sub">
          <span>{c.concepto}</span>
          <span className="dos-er-monto">{fmt(c.monto)} <span className="dos-er-pct">({fmtPct(c.pct)})</span></span>
        </div>
      )))}
    </div>
  )

  return (
    <section className="card dos-er-card">
      <div className="dos-body">
        {dossier.snapshot_stale && (
          <DossierDesfase
            dossierId={dossier.dossier_id}
            tieneBase={tieneBase}
            onActualizado={onRefrescar}
            mensaje={
              <>
                <strong>Datos desfasados.</strong> Cambiaste la moneda, la empresa o el período: este estado
                (y el PDF que descargues) aún corresponde al snapshot anterior.
              </>
            }
          />
        )}

        {/* Segunda ubicación del gancho (M3): el desglose vacío es exactamente lo
            que Contabilidad rellenaría, así que se nombra donde se echa en falta.
            Con desglose no aparece: ya tiene lo que se le ofrecería. */}
        {!tieneBase && sinDesglose && (
          <AvisoContabilidad
            texto="Tu estado de resultados tiene los totales, pero no dice en qué se va el dinero. Puedes escribirlo en «El desglose», o dejar que Contabilidad lo saque de tus gastos reales."
          />
        )}

        <div className="dos-er-head">
          <div>
            <h2 className="dos-section-title">Estado de resultados</h2>
            <p className="dos-section-hint">
              {periodo && <>{periodo} · </>}{congeladoA(dossier.snapshot_at)} · Importes en {dossier.moneda_presentacion}.
            </p>
          </div>
          <button className="btn btn-secondary" onClick={descargar} disabled={descargando}>
            {descargando ? <Loader2 size={14} strokeWidth={2.5} className="dos-spin" /> : <Download size={14} strokeWidth={2.5} />}
            {descargando ? 'Generando…' : 'Descargar PDF'}
          </button>
        </div>

        {/* Selector de modo + encuadre de vista previa. Van juntos a propósito: el
            dueño elige cuánto enseña MIRANDO lo que enseña, no a ciegas desde otra
            pantalla. Cambia el PDF y el enlace público a la vez que esto. */}
        <div className="dos-modo">
          <div className="dos-modo-cabeza">
            <Eye size={14} strokeWidth={2} aria-hidden="true" />
            <span className="dos-modo-titulo">Así verá tu estado de resultados quien lo reciba</span>
          </div>
          {/* Sin gate de solo-lectura en cliente, como el resto del dossier: el
              candado real lo pone `guardarModoEstado` en servidor. */}
          <div className="dos-modo-opciones" role="group" aria-label="Qué se publica del estado de resultados">
            {MODOS_ESTADO.map(m => (
              <button
                key={m} type="button"
                className={`cxx-chip${modo === m ? ' active' : ''}`}
                onClick={() => cambiarModo(m)}
                disabled={guardando}
                aria-pressed={modo === m}
              >
                {LABEL_MODO_ESTADO[m]}
              </button>
            ))}
          </div>
          <p className="dos-modo-ayuda">
            {AYUDA_MODO_ESTADO[modo]}
            {detallar && sinDesglose && ' Todavía no has escrito ningún concepto: complétalo en el paso «El desglose».'}
          </p>
        </div>

        <div className="dos-resumen">
          <div className="dos-resumen-item">
            <span className="dos-resumen-label">Margen bruto</span>
            <span className="dos-resumen-valor">{fmt(er.margenBruto)} {simbolo} · {fmtPct(er.margenBrutoPct)}</span>
          </div>
          <div className="dos-resumen-item">
            <span className="dos-resumen-label">Resultado neto</span>
            <span className="dos-resumen-valor">{fmt(er.resultadoNeto)} {simbolo} · {fmtPct(er.margenNetoPct)}</span>
          </div>
        </div>

        <div className="dos-er-bloques">
          <Grupo titulo="Ingresos" total={er.ingresos} pct={null} cats={er.ingresosPorCategoria} />
          <Grupo titulo="Coste de ventas" total={er.costoVentas} pct={er.costoVentasPct} cats={er.costoPorCategoria} />

          <div className="dos-er-total">
            <span>Margen bruto <span className="dos-er-pct">({fmtPct(er.margenBrutoPct)})</span></span>
            <strong className="dos-er-monto">{fmt(er.margenBruto)}</strong>
          </div>

          <Grupo titulo="Gastos operativos" total={er.gastosOperativos} pct={er.gastosOperativosPct} cats={er.gastosPorCategoria} />

          <div className="dos-er-total dos-er-total-final">
            <span>Resultado neto <span className="dos-er-pct">({fmtPct(er.margenNetoPct)})</span></span>
            <strong className="dos-er-monto">{fmt(er.resultadoNeto)}</strong>
          </div>
        </div>

        {er.evolucion.length > 1 && (
          <>
            <h3 className="dos-er-subtitulo">Evolución mensual</h3>
            <div className="table-wrapper">
              <table className="table">
                <thead>
                  <tr>
                    <th>Mes</th>
                    <th className="col-num">Ingresos</th>
                    <th className="col-num">Coste de ventas</th>
                    <th className="col-num">Gastos operativos</th>
                    <th className="col-num">Neto</th>
                  </tr>
                </thead>
                <tbody>
                  {er.evolucion.map(e => (
                    <tr key={e.mes}>
                      <td data-label="Mes">{etiquetaMes(e.mes)}</td>
                      <td data-label="Ingresos" className="col-num">{fmt(e.ingresos)}</td>
                      <td data-label="Coste de ventas" className="col-num">{fmt(e.costoVentas)}</td>
                      <td data-label="Gastos operativos" className="col-num">{fmt(e.gastosOperativos)}</td>
                      <td data-label="Neto" className="col-num">{fmt(e.neto)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        {nota && <p className="dos-er-nota">{nota}</p>}
      </div>
    </section>
  )
}
