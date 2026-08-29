'use client'

import { useState, useTransition } from 'react'
import dynamic from 'next/dynamic'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  exportarReportesRrhhXlsx,
  type ReportesRrhhData,
} from '@/app/actions/portal/rrhh'
import { BarChart3, Download, ChevronDown } from 'lucide-react'
import { EmpresaTag }   from '@/components/portal/EmpresaTag'
import EmpresaPills     from '@/components/portal/EmpresaPills'
import { useEmpresas }  from '@/components/portal/EmpresaColorContext'
import IaTouchpoint     from '@/components/portal/ia/IaTouchpoint'
import { toastError, toastLoading, toastSuccess } from '@/app/contexts/ToastContext'
import { descargarBase64, XLSX_MIME } from '@/lib/exportar/descargar'
import { crearDoc, cabeceraReporte, sellarPie } from '@/lib/pdf/documento'
import { crearCursor } from '@/lib/pdf/reporte'
import { formatMesRrhh } from '@/lib/rrhh/reportes'

// Recharts (~100 KB gzip) baja aparte: el gráfico solo existe cuando hay UNA
// moneda en juego, así que en el resto de casos ni se descarga.
const CosteMensualChart = dynamic(() => import('./CosteMensualChart'), {
  ssr: false,
  loading: () => <div className="dash-chart dash-chart-skeleton" aria-hidden />,
})

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatMonto(n: number): string {
  return n.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
/** «120.000,00 CUP · 900,00 USD» — dos monedas NO se suman en un número. */
function lineaMoneda(ms: { moneda: string; monto: number }[]): string {
  return ms.length ? ms.map(m => `${formatMonto(m.monto)} ${m.moneda}`).join(' · ') : '—'
}
/** Días de vacaciones: hasta 4 decimales, sin ceros de relleno (8, 8,5, 2,3636). Los
 *  cuatro son los del cálculo: el derecho se acumula a `días ÷ 11`, que casi nunca cae
 *  en dos decimales, y recortar en pantalla descuadra la suma de la columna. */
function formatDiasRep(n: number): string {
  return Number(n.toFixed(4)).toLocaleString('es-ES', { maximumFractionDigits: 4 })
}

// ── Página: Reportes de RRHH ─────────────────────────────────────────────────────

export default function ReportesView({ data, anio }: { data: ReportesRrhhData; anio: string }) {
  const router = useRouter()
  const params = useSearchParams()
  const filtroEmpresa = params.get('empresa') ?? ''

  // El estado vive en la URL como en el resto del portal: refrescar —o que se caiga la
  // conexión— ya no devuelve el informe al año en curso y a «todas las empresas».
  function navegar(cambios: Record<string, string>) {
    const url = new URLSearchParams(params.toString())
    for (const [k, v] of Object.entries(cambios)) { if (v) url.set(k, v); else url.delete(k) }
    router.replace(`?${url.toString()}`, { scroll: false })
  }

  const { colorOf } = useEmpresas()
  const empresasFiltro = data.empresas.map(e => ({
    empresa_id: e.empresa_id, nombre: e.nombre, color: colorOf(e.empresa_id),
  }))

  // La agregación llega YA HECHA desde el servidor (`obtenerReportesRrhh`), con el mismo
  // `construirReportesRrhh` que usa el Excel. Antes esta vista recibía la historia
  // completa de nómina —con su desglose y su desfase recalculado— para sumarla en el
  // navegador: la pantalla que menos filas necesitaba era la que más traía.
  const { plantilla, altas, bajas, costeAnual, costePorMes, porDepto, porEmpresa,
          vacaciones, onat, costeMedio, rotacion, antiguedad, porCargo,
          fondoSubsidios } = data.reportes
  const sinDatos = data.sinDatos

  const empresaNombre = filtroEmpresa
    ? (data.empresas.find(e => e.empresa_id === filtroEmpresa)?.nombre ?? '')
    : 'Todas las empresas'

  // ── Descarga ──────────────────────────────────────────────────────────────
  const [menuOpen,    setMenuOpen]    = useState(false)
  const [descargando, setDescargando] = useState(false)
  const [, startTransition] = useTransition()

  /** El PDF se dibuja con el CURSOR común (`lib/pdf/reporte.ts`), no a mano. Ahí vive
   *  `textoPdfSeguro`, la protección contra el gotcha WinAnsi del signo menos: una
   *  segunda implementación del cursor era una segunda forma de tropezar con él. */
  async function descargarPDF() {
    setMenuOpen(false)
    if (descargando) return
    setDescargando(true)
    try {
      const doc = await crearDoc()
      const cur = crearCursor(doc)
      cur.y = cabeceraReporte(doc, {
        titulo:    'Reportes de personal',
        izquierda: empresaNombre,
        derecha:   `Año ${anio}${data.ver ? ` · en ${data.ver}` : ''}`,
      })

      cur.titulo('Resumen')
      cur.fila('Plantilla activa', String(plantilla))
      cur.fila(`Altas en ${anio}`, String(altas))
      cur.fila(`Bajas en ${anio}`, String(bajas))
      for (const c of costeAnual) cur.filaTotal(`Coste de personal (${c.moneda})`, formatMonto(c.monto))
      for (const c of costeMedio) cur.fila(`Coste medio por persona (${c.moneda})`, formatMonto(c.monto))

      cur.salto(2); cur.titulo(`Cómo se movió la plantilla · ${anio}`)
      cur.fila(`Al empezar ${anio}`, String(rotacion.plantillaInicio))
      cur.fila(`Al acabar ${anio}`,  String(rotacion.plantillaFin))
      cur.fila('Plantilla media',    String(rotacion.plantillaMedia))
      if (rotacion.indice !== null) cur.fila('Rotación (bajas ÷ plantilla media)', `${rotacion.indice} %`)
      if (antiguedad.mediaAnios !== null) cur.fila('Antigüedad media', `${antiguedad.mediaAnios} años`)
      if (antiguedad.veterano) {
        cur.fila('Más antiguo', `${antiguedad.veterano.nombre} (${antiguedad.veterano.anios} años)`)
      }

      cur.salto(2); cur.titulo(`Coste de personal por mes · ${anio}`)
      if (costePorMes.length === 0) cur.nota('Sin nóminas confirmadas en el período.')
      else {
        cur.cabeceraTabla('Mes', 'Coste')
        for (const r of costePorMes) cur.fila(formatMesRrhh(r.periodo), lineaMoneda(r.monedas))
      }

      cur.salto(2); cur.titulo('Plantilla por departamento')
      cur.cabeceraTabla('Departamento', `Coste ${anio}`)
      for (const d of porDepto) cur.fila(`${d.departamento} (${d.activos})`, lineaMoneda(d.coste))

      cur.salto(2); cur.titulo('Plantilla por cargo')
      cur.cabeceraTabla('Cargo', `Coste ${anio}`)
      for (const c of porCargo) cur.fila(`${c.cargo} (${c.activos})`, lineaMoneda(c.coste))

      if (vacaciones.porTrabajador.length) {
        cur.salto(2); cur.titulo(`Submayor de vacaciones · ${anio}`)
        cur.nota('Saldo inicial + acumulado − pagado (disfrute y liquidación) = saldo final. '
          + 'El día se valora al promedio del saldo; el final es el pasivo vivo del negocio.')
        cur.cabeceraTabla('Trabajador', 'Saldo final')
        for (const v of vacaciones.porTrabajador) {
          cur.fila(v.nombre, `${formatMonto(v.finalImporte)} ${v.moneda} · ${formatDiasRep(v.finalDias)} d.`)
        }
        for (const t of vacaciones.total) cur.filaTotal(`Total (${t.moneda})`, formatMonto(t.monto))
      }

      if (onat.length) {
        cur.salto(2); cur.titulo(`Tributos de nómina · ${anio}`)
        cur.cabeceraTabla('Concepto', 'Importe')
        for (const o of onat) cur.fila(o.concepto, lineaMoneda(o.monedas))
      }

      if (data.convertido) {
        cur.salto(2)
        cur.nota(`Hay importes convertidos a ${data.ver} con la tasa vigente.`)
      }

      sellarPie(doc)
      doc.save(`reportes_rrhh_${anio}.pdf`)
    } finally {
      setDescargando(false)
    }
  }

  /** El .xlsx se genera en SERVIDOR. Sustituye al CSV que se armaba en el navegador:
   *  al asesor le llegaban los importes como texto, sin poder sumarlos. */
  function descargarExcel() {
    setMenuOpen(false)
    if (descargando) return
    setDescargando(true)
    const ld = toastLoading('Preparando el Excel…')
    startTransition(async () => {
      const res = await exportarReportesRrhhXlsx(anio, filtroEmpresa, data.ver)
      await ld.dismiss()
      setDescargando(false)
      if (!res.ok || !res.base64) { toastError(res.error ?? 'No se pudo exportar.'); return }
      descargarBase64(res.nombre ?? 'reportes-personal.xlsx', res.base64, XLSX_MIME)
      toastSuccess('Excel descargado')
    })
  }

  // Serie del gráfico: de más antiguo a más reciente (la tabla va al revés, que es como
  // se consulta «lo último»; un gráfico al revés no se lee).
  const serie = [...costePorMes].reverse().map(r => ({
    mes:   formatMesRrhh(r.periodo).split(' ')[0].slice(0, 3),
    coste: r.monedas.reduce((s, m) => s + m.monto, 0),
  }))
  // Con varias monedas sin convertir, sumar las barras sería inventar un total: el
  // gráfico solo aparece cuando hay UNA moneda en juego (nativa o de vista).
  const monedasEnJuego = new Set(costePorMes.flatMap(r => r.monedas.map(m => m.moneda)))
  const hayGrafico = serie.length > 1 && monedasEnJuego.size === 1
  const monedaGrafico = Array.from(monedasEnJuego)[0] ?? ''

  return (
    <div className="view-container">
      <div className="page-header">
        <div>
          <div className="page-title-ia">
            <h1 className="page-title">Reportes de personal</h1>
            <IaTouchpoint tipo="rrhh" descripcion="un análisis de tu coste de personal" />
          </div>
          <p className="page-subtitle">Plantilla, altas y bajas, coste de personal y lo que debes por tu nómina.</p>
        </div>
        {!sinDatos && (
          <div className="rep-dl">
            <button className="btn btn-secondary" onClick={() => setMenuOpen(v => !v)} disabled={descargando}>
              <Download size={14} /> {descargando ? 'Generando…' : 'Descargar'}
              <ChevronDown size={13} />
            </button>
            {menuOpen && (
              <>
                <div className="rep-dl-overlay" onClick={() => setMenuOpen(false)} />
                <div className="rep-dl-menu">
                  <button className="dropdown-item" onClick={descargarPDF}>Descargar PDF</button>
                  <button className="dropdown-item" onClick={descargarExcel}>Descargar Excel</button>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      <div className="ter-toolbar">
        <EmpresaPills
          empresas={empresasFiltro}
          value={filtroEmpresa}
          onChange={v => navegar({ empresa: v })}
          todasLabel="Todas"
        />
        <select className="input ter-filter-select" value={anio}
          aria-label="Año del informe"
          onChange={e => navegar({ anio: e.target.value })}>
          {data.anios.map(a => <option key={a} value={a}>Año {a}</option>)}
        </select>
        {/* «Ver en [moneda]», el mismo contrato que Reportes financieros: por defecto
            CADA MONEDA (informe nativo, sin convertir) y convertir es opt-in. Un negocio
            que paga en CUP y en USD veía las dos cifras concatenadas y no tenía forma de
            obtener un total. */}
        {data.monedas.length > 1 && (
          <select className="input ter-filter-select" value={data.ver}
            aria-label="Moneda en la que ver el informe"
            onChange={e => navegar({ ver: e.target.value })}>
            <option value="">Cada moneda</option>
            {data.monedas.map(m => <option key={m.codigo} value={m.codigo}>Ver en {m.codigo}</option>)}
          </select>
        )}
      </div>

      {sinDatos ? (
        <div className="card card-table">
          <div className="mon-empty">
            <BarChart3 size={40} strokeWidth={1} opacity={0.2} />
            <p>Aún no hay datos. Da de alta personal y confirma nóminas para ver aquí la plantilla y el coste de personal.</p>
          </div>
        </div>
      ) : (
        <>
          {data.convertido && (
            <div className="alert alert-info alert-intro">
              Hay importes <strong>convertidos a {data.ver}</strong> con la tasa vigente. Las
              cifras que ya estaban en {data.ver} no se han tocado.
            </div>
          )}

          {/* KPIs */}
          <div className="gc-stats">
            <div className="gc-stat-card">
              <div className="gc-stat-label">Plantilla activa</div>
              <div className="rrhh-kpi-value">{plantilla}</div>
            </div>
            <div className="gc-stat-card">
              <div className="gc-stat-label">Altas en {anio}</div>
              <div className="rrhh-kpi-value">{altas}</div>
            </div>
            <div className="gc-stat-card">
              <div className="gc-stat-label">Bajas en {anio}</div>
              <div className="rrhh-kpi-value">{bajas}</div>
            </div>
            <div className="gc-stat-card gc-stat-pagar">
              <div className="gc-stat-label">Coste de personal {anio}</div>
              {costeAnual.length === 0
                ? <div className="gc-stat-empty">Sin nóminas confirmadas</div>
                : costeAnual.map(c => (
                    <div key={c.moneda} className="gc-stat-line"><span>{c.moneda}</span><strong>{formatMonto(c.monto)}</strong></div>
                  ))}
            </div>
            {/* La deuda de vacaciones: un pasivo real que se derivaba persona a persona
                y no se agregaba en ninguna parte. */}
            {vacaciones.total.length > 0 && (
              <div className="gc-stat-card gc-stat-pagar">
                <div className="gc-stat-label">Vacaciones acumuladas (deuda)</div>
                {vacaciones.total.map(c => (
                  <div key={c.moneda} className="gc-stat-line"><span>{c.moneda}</span><strong>{formatMonto(c.monto)}</strong></div>
                ))}
              </div>
            )}
            {/* El fondo del 1,5 %: la provisión de subsidios por enfermedad, un saldo interno
                que no se paga al Estado y que puede quedar en negativo (lo absorbe la empresa). */}
            {fondoSubsidios.total.length > 0 && (
              <div className="gc-stat-card">
                <div className="gc-stat-label">Fondo del 1,5 % (subsidios)</div>
                {fondoSubsidios.total.map(c => (
                  <div key={c.moneda} className="gc-stat-line"><span>{c.moneda}</span><strong>{formatMonto(c.monto)}</strong></div>
                ))}
              </div>
            )}
            {/* El coste medio se divide por la plantilla MEDIA del año, no por la de hoy:
                un negocio que empezó con 4 y acabó con 12 no reparte el coste entre 12. */}
            {costeMedio.length > 0 && (
              <div className="gc-stat-card">
                <div className="gc-stat-label">Coste medio por persona</div>
                {costeMedio.map(c => (
                  <div key={c.moneda} className="gc-stat-line"><span>{c.moneda}</span><strong>{formatMonto(c.monto)}</strong></div>
                ))}
              </div>
            )}
          </div>

          <div className="info-box">
            <span className="text-xs-muted">El coste de personal son las nóminas <strong>confirmadas</strong> del período; coincide con los gastos de categoría <strong>«Salarios»</strong> de Reportes financieros (Tesorería refleja lo realmente pagado).</span>
          </div>

          {/* ── Cómo se movió la plantilla ──────────────────────────────────────
              La rotación va con las piezas del cálculo DELANTE, no como índice suelto:
              un 66 % asusta hasta que se ve que el negocio tiene tres personas. */}
          <div className="card card-table rrhh-card-gap">
            <div className="ter-card-head"><span className="ter-form-section-title">Cómo se movió la plantilla · {anio}</span></div>
            <div className="table-wrapper">
              <table className="table">
                <thead>
                  <tr><th>Indicador</th><th className="col-num">Valor</th></tr>
                </thead>
                <tbody>
                  <tr>
                    <td data-label="Indicador">Al empezar {anio}</td>
                    <td data-label="Valor" className="col-num tes-monto-cell">{rotacion.plantillaInicio}</td>
                  </tr>
                  <tr>
                    <td data-label="Indicador">Al acabar {anio}</td>
                    <td data-label="Valor" className="col-num tes-monto-cell">{rotacion.plantillaFin}</td>
                  </tr>
                  <tr>
                    <td data-label="Indicador">
                      <strong>Plantilla media</strong>
                      <div className="text-sm-muted">La base con la que se calculan el coste medio y la rotación.</div>
                    </td>
                    <td data-label="Valor" className="col-num tes-monto-cell">{rotacion.plantillaMedia}</td>
                  </tr>
                  <tr>
                    <td data-label="Indicador">
                      Rotación
                      <div className="text-sm-muted">Bajas del año sobre la plantilla media.</div>
                    </td>
                    <td data-label="Valor" className="col-num tes-monto-cell">
                      {rotacion.indice === null ? '—' : `${rotacion.indice} %`}
                    </td>
                  </tr>
                  <tr>
                    <td data-label="Indicador">
                      Antigüedad media
                      {antiguedad.veterano && (
                        <div className="text-sm-muted">
                          El más antiguo: {antiguedad.veterano.nombre} ({antiguedad.veterano.anios} años).
                        </div>
                      )}
                    </td>
                    <td data-label="Valor" className="col-num tes-monto-cell">
                      {antiguedad.mediaAnios === null ? '—' : `${antiguedad.mediaAnios} años`}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          {/* Coste por mes — gráfico + tabla */}
          <div className="card card-table rrhh-card-gap">
            <div className="ter-card-head"><span className="ter-form-section-title">Coste de personal por mes · {anio}</span></div>
            {costePorMes.length === 0 ? (
              <div className="mon-empty"><BarChart3 size={32} strokeWidth={1} opacity={0.2} /><p>Sin nóminas confirmadas en {anio}.</p></div>
            ) : (
              <>
                {hayGrafico && <CosteMensualChart serie={serie} moneda={monedaGrafico} />}
                <div className="table-wrapper">
                  <table className="table">
                    <thead><tr><th>Mes</th><th className="col-num">Coste</th></tr></thead>
                    <tbody>
                      {costePorMes.map(r => (
                        <tr key={r.periodo}>
                          <td data-label="Mes"><strong>{formatMesRrhh(r.periodo)}</strong></td>
                          <td data-label="Coste" className="col-num tes-monto-cell">{lineaMoneda(r.monedas)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>

          {/* Lo que se le debe a ONAT: el dato estaba entero en los ítems y había que ir
              a rebuscarlo a Cuentas por pagar fila por fila. */}
          {data.hayCuba && onat.length > 0 && (
            <div className="card card-table rrhh-card-gap">
              <div className="ter-card-head"><span className="ter-form-section-title">Tributos de nómina · {anio}</span></div>
              <div className="table-wrapper">
                <table className="table">
                  <thead><tr><th>Concepto</th><th className="col-num">Importe</th></tr></thead>
                  <tbody>
                    {onat.map(o => (
                      <tr key={o.concepto}>
                        <td data-label="Concepto"><strong>{o.concepto}</strong></td>
                        <td data-label="Importe" className="col-num tes-monto-cell">{lineaMoneda(o.monedas)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="info-box">
                <span className="text-xs-muted">Lo retenido al trabajador y lo aportado por la empresa en las nóminas <strong>confirmadas</strong>. Cada uno tiene su propia deuda en <strong>Cuentas por pagar</strong>, con su vencimiento.</span>
              </div>
            </div>
          )}

          {/* Submayor de vacaciones por trabajador: el saldo se abre, se mueve y se cierra,
              en importe y en días. El día se valora al promedio del saldo (importe ÷ días). */}
          {vacaciones.porTrabajador.length > 0 && (
            <div className="card card-table rrhh-card-gap">
              <div className="ter-card-head"><span className="ter-form-section-title">Submayor de vacaciones · {anio}</span></div>
              <div className="table-wrapper">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Trabajador</th>
                      <th className="col-num">Saldo inicial</th>
                      <th className="col-num">Acumulado</th>
                      <th className="col-num">Pagado / liquidado</th>
                      <th className="col-num">Saldo final</th>
                    </tr>
                  </thead>
                  <tbody>
                    {vacaciones.porTrabajador.map(v => (
                      <tr key={v.nombre}>
                        <td data-label="Trabajador"><strong>{v.nombre}</strong></td>
                        <td data-label="Saldo inicial" className="col-num tes-monto-cell">
                          {formatMonto(v.inicialImporte)} {v.moneda}
                          <div className="text-xs-muted">{formatDiasRep(v.inicialDias)} d.</div>
                        </td>
                        <td data-label="Acumulado" className="col-num tes-monto-cell">
                          {formatMonto(v.acumuladoImporte)} {v.moneda}
                          <div className="text-xs-muted">{formatDiasRep(v.acumuladoDias)} d.</div>
                        </td>
                        <td data-label="Pagado / liquidado" className="col-num tes-monto-cell">
                          {formatMonto(v.pagadoImporte)} {v.moneda}
                          <div className="text-xs-muted">{formatDiasRep(v.pagadoDias)} d.</div>
                        </td>
                        <td data-label="Saldo final" className="col-num tes-monto-cell">
                          <strong>{formatMonto(v.finalImporte)} {v.moneda}</strong>
                          <div className="text-xs-muted">{formatDiasRep(v.finalDias)} d.</div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Submayor del fondo del 1,5 %: la provisión se abre, se acumula, se paga y se
              cierra, por moneda. El saldo puede ser negativo —lo absorbe la empresa— y no se
              liquida nunca al Estado; por eso NO va en «Tributos de nómina». */}
          {fondoSubsidios.porMoneda.length > 0 && (
            <div className="card card-table rrhh-card-gap">
              <div className="ter-card-head"><span className="ter-form-section-title">Fondo del 1,5 % · {anio}</span></div>
              <div className="table-wrapper">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Moneda</th>
                      <th className="col-num">Saldo inicial</th>
                      <th className="col-num">Provisionado</th>
                      <th className="col-num">Subsidios de enfermedad</th>
                      <th className="col-num">Saldo final</th>
                    </tr>
                  </thead>
                  <tbody>
                    {fondoSubsidios.porMoneda.map(f => (
                      <tr key={f.moneda}>
                        <td data-label="Moneda"><strong>{f.moneda}</strong></td>
                        <td data-label="Saldo inicial" className="col-num tes-monto-cell">{formatMonto(f.inicial)}</td>
                        <td data-label="Provisionado" className="col-num tes-monto-cell">{formatMonto(f.provisionadoAnio)}</td>
                        <td data-label="Subsidios de enfermedad" className="col-num tes-monto-cell">{formatMonto(f.pagadoAnio)}</td>
                        <td data-label="Saldo final" className="col-num tes-monto-cell"><strong>{formatMonto(f.final)}</strong></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="info-box">
                <span className="text-xs-muted">El 1,5 % de Seguridad Social no se ingresa al Estado: es una <strong>provisión</strong> que alimenta este fondo y de la que salen los <strong>subsidios por enfermedad</strong>. La maternidad no lo toca (la reembolsa el Estado). Un saldo negativo es normal: la empresa lo absorbe y lo compensa con lo que acumulará.</span>
              </div>
            </div>
          )}

          {/* Desglose por empresa (vista consolidada) */}
          {porEmpresa.length > 0 && (
            <div className="card card-table rrhh-card-gap">
              <div className="ter-card-head"><span className="ter-form-section-title">Plantilla y coste por empresa · {anio}</span></div>
              <div className="table-wrapper">
                <table className="table">
                  <thead><tr><th>Empresa</th><th>Activos</th><th className="col-num">Coste {anio}</th></tr></thead>
                  <tbody>
                    {porEmpresa.map(e => (
                      <tr key={e.empresa_id}>
                        <td data-label="Empresa"><EmpresaTag color={colorOf(e.empresa_id)} nombre={e.nombre} /></td>
                        <td data-label="Activos" className="text-sm-muted">{e.activos}</td>
                        <td data-label={`Coste ${anio}`} className="col-num tes-monto-cell">{lineaMoneda(e.coste)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Plantilla y coste por departamento */}
          <div className="card card-table rrhh-card-gap">
            <div className="ter-card-head"><span className="ter-form-section-title">Plantilla por departamento</span></div>
            <div className="table-wrapper">
              <table className="table">
                <thead><tr><th>Departamento</th><th>Activos</th><th className="col-num">Coste {anio}</th></tr></thead>
                <tbody>
                  {porDepto.map(d => (
                    <tr key={d.departamento}>
                      <td data-label="Departamento"><strong>{d.departamento}</strong></td>
                      <td data-label="Activos" className="text-sm-muted">{d.activos}</td>
                      <td data-label={`Coste ${anio}`} className="col-num tes-monto-cell">{lineaMoneda(d.coste)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Por CARGO responde otra pregunta que por departamento: «Cocina» no dice
              cuánto cuesta tener tres cocineros y un friegaplatos. */}
          <div className="card card-table rrhh-card-gap">
            <div className="ter-card-head"><span className="ter-form-section-title">Plantilla por cargo</span></div>
            <div className="table-wrapper">
              <table className="table">
                <thead><tr><th>Cargo</th><th>Activos</th><th className="col-num">Coste {anio}</th></tr></thead>
                <tbody>
                  {porCargo.map(c => (
                    <tr key={c.cargo}>
                      <td data-label="Cargo"><strong>{c.cargo}</strong></td>
                      <td data-label="Activos" className="text-sm-muted">{c.activos}</td>
                      <td data-label={`Coste ${anio}`} className="col-num tes-monto-cell">{lineaMoneda(c.coste)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
