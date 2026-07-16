'use client'

import { useMemo, useState } from 'react'
import { Download, Loader2, BarChart3, AlertTriangle } from 'lucide-react'
import { toastError } from '@/app/contexts/ToastContext'
import { estadoDeResultados, notaConversion, congeladoA } from '@/lib/dossier/estado'
import { etiquetaMes, type FilaSerie } from '@/lib/dossier/snapshot'
import type { DossierBasico } from '@/app/actions/portal/dossier'
import type { LineaDesglose } from '@/lib/dossier/base'

// El estado de resultados en pantalla ANTES de descargarlo: en Cuba bajar un PDF
// solo para revisarlo cuesta datos (y es lo que ya hace ReportesView). El PDF se
// genera del mismo cálculo puro, así que pantalla y archivo no pueden divergir.

const nf = new Intl.NumberFormat('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmt = (n: number) => nf.format(n)
const fmtPct = (n: number) => `${n.toFixed(1).replace('.', ',')} %`

// Normaliza un nombre para el archivo (sin acentos ni símbolos).
function slug(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').toLowerCase() || 'dossier'
}

export default function PestanaEstado({
  dossier, serie, lineas, empresaNombre, simbolo,
}: {
  dossier: DossierBasico
  serie: FilaSerie[]
  lineas: LineaDesglose[]
  empresaNombre: string
  simbolo: string
}) {
  const er = useMemo(() => estadoDeResultados(serie, lineas), [serie, lineas])
  const nota = useMemo(
    () => notaConversion(dossier.moneda_presentacion, dossier.tasas_usadas, dossier.monedas_faltantes),
    [dossier.moneda_presentacion, dossier.tasas_usadas, dossier.monedas_faltantes],
  )

  const [descargando, setDescargando] = useState(false)

  async function descargar() {
    if (descargando) return
    setDescargando(true)
    try {
      // Import dinámico: jsPDF no entra en el bundle del portal (patrón _DocumentoPdf).
      const { descargarEstadoResultados } = await import('@/lib/pdf/dossier')
      const archivo = `estado_de_resultados_${slug(empresaNombre)}_${dossier.periodo_desde ?? ''}_${dossier.periodo_hasta ?? ''}.pdf`
      await descargarEstadoResultados({
        empresa:      empresaNombre,
        moneda:       dossier.moneda_presentacion,
        periodoDesde: dossier.periodo_desde,
        periodoHasta: dossier.periodo_hasta,
        snapshotAt:   dossier.snapshot_at,
        serie, lineas,
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

  const grupos: { titulo: string; total: number; cats: { concepto: string; monto: number }[] }[] = [
    { titulo: 'Ingresos',          total: er.ingresos,          cats: er.ingresosPorCategoria },
    { titulo: 'Coste de ventas',   total: er.costoVentas,       cats: er.costoPorCategoria },
  ]
  const gastos = { titulo: 'Gastos operativos', total: er.gastosOperativos, cats: er.gastosPorCategoria }

  return (
    <section className="card dos-er-card">
      <div className="dos-body">
        {dossier.snapshot_stale && (
          <div className="dos-desfase" role="alert">
            <AlertTriangle size={16} strokeWidth={2} />
            <div className="dos-desfase-texto">
              <strong>Datos desfasados.</strong> Cambiaste la moneda, la empresa o el período: este estado
              (y el PDF que descargues) aún corresponde al snapshot anterior. Sincronízalo en «Mi dossier» → «Los números».
            </div>
          </div>
        )}

        <div className="dos-er-head">
          <div>
            <h2 className="dos-section-title">Estado de resultados</h2>
            <p className="dos-section-hint">
              {congeladoA(dossier.snapshot_at)} · Importes en {dossier.moneda_presentacion}.
            </p>
          </div>
          <button className="btn btn-secondary" onClick={descargar} disabled={descargando}>
            {descargando ? <Loader2 size={14} strokeWidth={2.5} className="dos-spin" /> : <Download size={14} strokeWidth={2.5} />}
            {descargando ? 'Generando…' : 'Descargar PDF'}
          </button>
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
          {grupos.map(g => (
            <div key={g.titulo} className="dos-er-bloque">
              <div className="dos-er-linea dos-er-linea-head">
                <span>{g.titulo}</span>
                <strong className="dos-er-monto">{fmt(g.total)}</strong>
              </div>
              {g.cats.length === 0 ? (
                <div className="dos-er-linea dos-er-sub"><span>Sin desglose por categoría</span><span>—</span></div>
              ) : g.cats.map(c => (
                <div key={c.concepto} className="dos-er-linea dos-er-sub">
                  <span>{c.concepto}</span>
                  <span className="dos-er-monto">{fmt(c.monto)}</span>
                </div>
              ))}
            </div>
          ))}

          <div className="dos-er-total">
            <span>Margen bruto <span className="dos-er-pct">({fmtPct(er.margenBrutoPct)})</span></span>
            <strong className="dos-er-monto">{fmt(er.margenBruto)}</strong>
          </div>

          <div className="dos-er-bloque">
            <div className="dos-er-linea dos-er-linea-head">
              <span>{gastos.titulo}</span>
              <strong className="dos-er-monto">{fmt(gastos.total)}</strong>
            </div>
            {gastos.cats.length === 0 ? (
              <div className="dos-er-linea dos-er-sub"><span>Sin desglose por categoría</span><span>—</span></div>
            ) : gastos.cats.map(c => (
              <div key={c.concepto} className="dos-er-linea dos-er-sub">
                <span>{c.concepto}</span>
                <span className="dos-er-monto">{fmt(c.monto)}</span>
              </div>
            ))}
          </div>

          <div className="dos-er-total dos-er-total-final">
            <span>Resultado neto <span className="dos-er-pct">({fmtPct(er.margenNetoPct)})</span></span>
            <strong className="dos-er-monto">{fmt(er.resultadoNeto)}</strong>
          </div>
        </div>

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

        {nota && <p className="dos-er-nota">{nota}</p>}
      </div>
    </section>
  )
}
