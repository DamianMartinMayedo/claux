'use client'

import IaTouchpoint from '@/components/portal/ia/IaTouchpoint'
import { toastError, toastLoading } from '@/app/contexts/ToastContext'
import { Fragment, useState, useTransition, useMemo } from 'react'
import { useRouter, useSearchParams }       from 'next/navigation'
import Link                                 from 'next/link'
import { Check, ChevronDown, DollarSign, ExternalLink, Trash2, X } from 'lucide-react'
import {
  registrarPagoDoc,
  anularPagoDoc,
  type CuentasPageData,
  type DocumentoPendiente,
  type Tramo,
} from '@/app/actions/portal/cobranza'
import LiquidarCuentaFields, { type LiquidarState } from '@/app/portal/(app)/_shared/LiquidarCuentaFields'
import { EmpresaTag, empresaColorVar } from '@/components/portal/EmpresaTag'
import { RowActions }                  from '@/components/portal/RowActions'
import { ConfirmDialog }                from '@/components/portal/Dialog'
import { usePagination, TablePagination } from '@/components/TablePagination'
import TablaCargando                    from '@/components/portal/TablaCargando'
import { useEmpresas }                 from '@/components/portal/EmpresaColorContext'
import ExportarMenu                    from '@/components/portal/ExportarMenu'
import Filtros                         from '@/components/portal/Filtros'
import { filtroExport, resumenDe, opcionesTercero, type Filtro } from '@/lib/filtros'
import { SIN_TERCERO }                 from '@/lib/listados'
// «Hoy» en la zona del NEGOCIO (America/Havana), no en UTC: con `toISOString()` a partir de
// las 20:00 la fecha ya es la de mañana, así que un documento registrado de noche el último
// día del mes caía en el mes siguiente. Una sola fuente: `lib/fecha-tz.ts`.
import { hoyEnTz } from '@/lib/fecha-tz'

// ── Constantes ────────────────────────────────────────────────────────────────

const TRAMO_LABEL: Record<Tramo, string> = {
  AL_DIA: 'Al día', V_1_30: '1–30 días', V_31_60: '31–60 días', V_60: '+60 días',
}
const TRAMO_BADGE: Record<Tramo, string> = {
  AL_DIA: 'badge-neutral', V_1_30: 'badge-warning', V_31_60: 'badge-warning', V_60: 'badge-error',
}
const TRAMOS: Tramo[] = ['AL_DIA', 'V_1_30', 'V_31_60', 'V_60']

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatMonto(n: number): string {
  return n.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
function hoyISO(): string { return hoyEnTz() }
function formatFecha(f: string | null): string {
  if (!f) return '—'
  const [y, m, d] = f.split('T')[0].split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' })
}

// ── Modal: registrar cobro / pago + historial ───────────────────────────────────

function PagoModal({
  doc, cuentas, modo, empresaNombres, onClose, onChanged,
}: {
  doc:      DocumentoPendiente
  cuentas:  CuentasPageData['cuentas']
  modo:     CuentasPageData['modo']
  empresaNombres: Record<string, string>
  onClose:  () => void
  onChanged: () => void
}) {
  const [isPending, startTransition] = useTransition()
  const [anularLiq, setAnularLiq] = useState<DocumentoPendiente['liquidaciones'][number] | null>(null)

  const esCobro        = modo === 'COBRAR'
  // Mostrar TODAS las cuentas (sin filtro por empresa): cobrar o pagar desde la caja de
  // otra empresa está PERMITIDO —el dueño suele tener una sola cartera—, pero el
  // movimiento se sella con la empresa de la CAJA, así que se avisa (lo hace
  // LiquidarCuentaFields con el nombre de la empresa delante).
  // Las de la misma moneda aparecen primero; las de otra moneda aplican tasa.
  const cuentasOrdenadas = [...cuentas]
    .sort((a, b) => (a.moneda === doc.moneda ? 0 : 1) - (b.moneda === doc.moneda ? 0 : 1))
    .map(c => ({ ...c, empresa_nombre: empresaNombres[c.empresa_id] }))
  const [liq, setLiq]  = useState<LiquidarState | null>(null)

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!liq || !liq.valido) return
    const fd = new FormData(e.currentTarget)
    fd.set('doc_tipo', doc.doc_tipo)
    fd.set('doc_id', doc.doc_id)
    fd.set('cuenta_id', liq.cuentaId)
    fd.set('monto', liq.monto)
    fd.set('tasa_cambio', String(liq.tasa))
    const ld = toastLoading('Registrando…')
    startTransition(async () => {
      const res = await registrarPagoDoc(fd)
      await ld.dismiss()
      if (!res.ok) { toastError(res.error ?? 'Error inesperado.'); return }
      onChanged()
    })
  }

  function handleAnular(movimiento_id: string) {
    const ld = toastLoading('Anulando…')
    startTransition(async () => {
      const res = await anularPagoDoc(movimiento_id)
      await ld.dismiss()
      if (!res.ok) { toastError(res.error ?? 'Error inesperado.'); return }
      onChanged()
    })
  }

  return (
    <div className="modal-backdrop open">
      <div className="modal modal-md" role="dialog" aria-modal>
        <div className="modal-header">
          <div>
            <h2 className="modal-title">{esCobro ? 'Registrar cobro' : 'Registrar pago'}</h2>
            <p className="text-xs-muted mt-1">
              {doc.numero} · {doc.tercero_nombre ? `${doc.tercero_nombre} · ` : ''}
              Total {formatMonto(doc.monto)} {doc.moneda} · Pendiente <strong>{formatMonto(doc.saldo)} {doc.moneda}</strong>
            </p>
          </div>
          <button type="button" className="modal-close" onClick={onClose}><X size={16} strokeWidth={2} /></button>
        </div>
        <div className="modal-body">
          {doc.saldo > 0.005 ? (
            cuentasOrdenadas.length === 0 ? (
              <div className="alert alert-warning">
                No tienes cajas disponibles. Crea una en Tesorería para registrar el {esCobro ? 'cobro' : 'pago'}.
              </div>
            ) : (
               <form id="cobro-form" onSubmit={handleSubmit} className="gc-liq-form">
                <div className="ter-form-grid">
                  <LiquidarCuentaFields
                    cuentas={cuentasOrdenadas}
                    docMoneda={doc.moneda}
                    saldo={doc.saldo}
                    docEmpresaId={doc.empresa_id}
                    docEmpresaNombre={empresaNombres[doc.empresa_id]}
                    onChange={setLiq}
                  />
                  <div className="input-group ter-col-span-3">
                    <label>Fecha <span className="required">*</span></label>
                    <input className="input" name="fecha" type="date" defaultValue={hoyISO()} required />
                  </div>
                  <div className="input-group ter-col-full">
                    <label>Notas</label>
                    <input className="input" name="notas" placeholder="Referencia…" />
                  </div>
                </div>
              </form>
            )
          ) : (
            <div className="alert alert-success">{esCobro ? 'Cobrado' : 'Pagado'} por completo.</div>
          )}
          {doc.liquidaciones.length > 0 && (
            <div className="gc-liq-historial">
              <span className="ter-form-section-title">{esCobro ? 'Cobros' : 'Pagos'} registrados</span>
              {doc.liquidaciones.map(l => (
                <div key={l.movimiento_id} className="gc-liq-row">
                  <span className="text-sm-muted tes-nowrap">{formatFecha(l.fecha)}</span>
                  <span className="gc-liq-cuenta">{l.cuenta_nombre}</span>
                  <span className="gc-liq-monto">{formatMonto(l.monto)} {doc.moneda}</span>
                  <button className="ter-action-btn ter-action-danger" title="Anular"
                    onClick={() => setAnularLiq(l)} disabled={isPending}><Trash2 size={14} strokeWidth={2} /></button>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="modal-footer">
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cerrar</button>
          {doc.saldo > 0.005 && cuentasOrdenadas.length > 0 && (
            <button type="submit" form="cobro-form" className="btn btn-primary" disabled={isPending || !liq?.valido}>
              {isPending ? <><span className="spinner spinner-sm" /> Registrando…</> : esCobro ? 'Registrar cobro' : 'Registrar pago'}
            </button>
          )}
        </div>
      </div>
      {anularLiq && (
        <ConfirmDialog
          title={esCobro ? '¿Anular este cobro?' : '¿Anular este pago?'}
          body={`Se eliminará el movimiento de ${formatMonto(anularLiq.monto)} ${doc.moneda} en ${anularLiq.cuenta_nombre} del ${formatFecha(anularLiq.fecha)}. El documento volverá a quedar pendiente. No se puede deshacer.`}
          confirmLabel={esCobro ? 'Anular cobro' : 'Anular pago'}
          danger
          onCancel={() => setAnularLiq(null)}
          onConfirm={() => { const mov = anularLiq.movimiento_id; setAnularLiq(null); handleAnular(mov) }}
        />
      )}
    </div>
  )
}

// ── Vista principal ─────────────────────────────────────────────────────────────

export default function CuentasView({ data, puedeEditar }: { data: CuentasPageData; puedeEditar: boolean }) {
  const router = useRouter()
  const { colorOf, nombreOf } = useEmpresas()
  const esCobro = data.modo === 'COBRAR'
  const multiempresa = data.empresas.length > 1
  const empresasFiltro = data.empresas.map(e => ({
    empresa_id: e.empresa_id, nombre: e.nombre, color: colorOf(e.empresa_id),
  }))

  const [pagoDoc,      setPagoDoc]      = useState<DocumentoPendiente | null>(null)
  // Qué documento tiene el desplegable abierto (ver el resto de datos sin abrir el
  // modal). Disponible también en solo-lectura: desplegar no escribe.
  const [detalle,      setDetalle]      = useState<string | null>(null)
  const [cargando,     setCargando]     = useState(false)

  // Los filtros viven en la URL, como en el resto del portal: volver de la ficha de una
  // factura, o refrescar en una conexión que se cae, ya no pierde lo que estabas mirando.
  const params = useSearchParams()
  const filtroTramo   = (params.get('tramo') ?? '') as Tramo | ''
  const filtroEmpresa = params.get('empresa') ?? ''
  const filtroTercero = params.get('tercero') ?? ''
  const busca         = params.get('q') ?? ''

  // Terceros que APARECEN en esta lista. Se derivan de los documentos y no del catálogo
  // completo: ofrecer 200 proveedores para filtrar 3 deudas no es un filtro, es un
  // desplegable. Ojo: no todo lo cobrable tiene tercero — el COBRO de subsidios de la
  // nómina entra en CxC sin `tercero_id` porque el deudor es la Seguridad Social, que no
  // es una ficha. De ahí la opción explícita «Sin {cliente}», para que se pueda ver y
  // reclamar en vez de quedar escondido por no tener con quién agruparlo.
  //
  // Se agrupan por FICHA (`tercero_id`), no por nombre. Agrupar por nombre parecía más
  // limpio —quitaba el duplicado del desplegable— y era el fallo: un tercero tiene una ficha
  // por empresa, así que las tres «CLAUDIA» de un negocio con tres empresas se fusionaban en
  // una opción y filtrar por ella enseñaba las deudas de las tres, sin decirlo. Ahora cada
  // ficha es su opción y la EMPRESA es el grupo del desplegable.
  const tercerosEnLista = useMemo(() => {
    const m = new Map<string, { tercero_id: string; nombre: string; empresa_id: string }>()
    for (const d of data.documentos) {
      if (!d.tercero_id || !d.tercero_nombre) continue
      if (!m.has(d.tercero_id)) {
        m.set(d.tercero_id, { tercero_id: d.tercero_id, nombre: d.tercero_nombre, empresa_id: d.empresa_id })
      }
    }
    return [...m.values()]
  }, [data.documentos])
  const haySinTercero = useMemo(
    () => data.documentos.some(d => !d.tercero_id), [data.documentos])

  const documentos = useMemo(() => {
    const t = busca.trim().toLowerCase()
    return data.documentos.filter(d => {
      if (filtroTramo   && d.tramo      !== filtroTramo)   return false
      if (filtroEmpresa && d.empresa_id !== filtroEmpresa) return false
      if (filtroTercero === SIN_TERCERO && d.tercero_id) return false
      if (filtroTercero && filtroTercero !== SIN_TERCERO && d.tercero_id !== filtroTercero) return false
      if (t && !(
        d.numero.toLowerCase().includes(t)
        || (d.tercero_nombre ?? '').toLowerCase().includes(t)
        || d.saldo.toFixed(2) === t.replace(',', '.')
      )) return false
      return true
    })
  }, [data.documentos, filtroTramo, filtroEmpresa, filtroTercero, busca])

  const { pageItems, ...pag } = usePagination(documentos)

  // Total pendiente por moneda DE LO QUE SE VE: la cabecera sumaba toda la lista mientras
  // la tabla enseñaba un filtro, y las dos cifras no cuadraban sin pista de por qué.
  const porMoneda = useMemo(() => {
    const m = new Map<string, number>()
    for (const d of documentos) m.set(d.moneda, (m.get(d.moneda) ?? 0) + d.saldo)
    return Array.from(m.entries()).map(([moneda, saldo]) => ({ moneda, saldo })).sort((a, b) => a.moneda.localeCompare(b.moneda))
  }, [documentos])

  // Conteo por tramo
  const conteoTramo = useMemo(() => {
    const m: Record<string, number> = {}
    for (const d of data.documentos) m[d.tramo] = (m[d.tramo] ?? 0) + 1
    return m
  }, [data.documentos])

  /**
   * LA DECLARACIÓN. De aquí salen la barra, el `FiltroExport` de la descarga y el texto del
   * desplegable.
   *
   * Todos en `cliente` y es correcto: CxC/CxP **no tienen techo**, se traen la deuda entera.
   * Filtrar en el navegador da aquí exactamente lo mismo que filtrar en la consulta.
   */
  const declaracion: Filtro[] = useMemo(() => [
    {
      // Los tramos eran `.cxx-chip`, una tercera familia de píldora solo para esta pantalla.
      // Son la misma píldora que las demás; lo que sí conservan es el CONTADOR, que aquí es
      // la información principal: se lee «cuánto tengo vencido a +60» antes de filtrar nada.
      clave: 'tramo', label: 'Todos', valor: filtroTramo, widget: 'pastillas', donde: 'cliente',
      rotulo: 'Antigüedad',
      todasCount: data.documentos.length,
      opciones: TRAMOS.filter(t => (conteoTramo[t] ?? 0) > 0)
        .map(t => ({ valor: t, label: TRAMO_LABEL[t], count: conteoTramo[t] })),
    },
    {
      clave: 'empresa_id', param: 'empresa', label: 'Todas',
      rotulo: 'Empresa',
      valor: filtroEmpresa, widget: 'pastillas', donde: 'cliente',
      ocultarSi: !multiempresa,
      opciones: empresasFiltro.map(e => ({ valor: e.empresa_id, label: e.nombre, color: e.color })),
    },
    {
      clave: 'tercero', label: esCobro ? 'Todos los clientes' : 'Todos los proveedores',
      rotulo: esCobro ? 'Cliente' : 'Proveedor',
      valor: filtroTercero, widget: 'select', donde: 'cliente',
      ocultarSi: data.documentos.length === 0,
      opciones: [
        ...(haySinTercero ? [{ valor: SIN_TERCERO, label: esCobro ? 'Sin cliente' : 'Sin proveedor' }] : []),
        ...opcionesTercero(tercerosEnLista, nombreOf, multiempresa, filtroEmpresa || undefined),
      ],
    },
  ], [filtroTramo, filtroEmpresa, filtroTercero, conteoTramo, empresasFiltro, multiempresa,
      esCobro, haySinTercero, tercerosEnLista, data.documentos.length, nombreOf])

  // Re-sincroniza el doc abierto tras refresh
  const pagoVivo = pagoDoc
    ? data.documentos.find(d => d.doc_id === pagoDoc.doc_id) ?? null
    : null

  function onChanged() { router.refresh() }

  const titulo   = esCobro ? 'Cuentas por cobrar' : 'Cuentas por pagar'
  const subtitulo = esCobro
    ? 'Facturas emitidas y cobros pendientes, ordenados por antigüedad.'
    : 'Gastos pendientes de pago, ordenados por antigüedad.'

  return (
    <div className="view-container">

      <div className="page-header">
        <div>
          <div className="page-title-ia">
            <h1 className="page-title">{titulo}</h1>
            <IaTouchpoint tipo="deudas" descripcion={esCobro ? 'un análisis de lo que te deben' : 'un análisis de lo que debes'} />
          </div>
          <p className="page-subtitle">{subtitulo}</p>
        </div>
        <div className="tes-header-actions">
          <ExportarMenu
            clave={esCobro ? 'cuentas_cobrar' : 'cuentas_pagar'}
            /* GENERADOS de la declaración: el fichero no puede quedarse corto respecto a la
               pantalla, ni el resumen imprimir un código interno. */
            filtro={filtroExport(declaracion, { q: busca })}
            resumen={[...resumenDe(declaracion), ...(busca ? [`«${busca}»`] : [])]}
          />
        </div>
      </div>

      {/* Totales por moneda */}
      {porMoneda.length > 0 && (
        <div className="tes-saldos-grid">
          {porMoneda.map(s => (
            <div key={s.moneda} className="tes-saldo-card">
              <div className="tes-saldo-moneda">{s.moneda}</div>
              <div className="tes-saldo-monto">{formatMonto(s.saldo)}</div>
              <div className="tes-saldo-label">{esCobro ? 'por cobrar' : 'por pagar'}</div>
            </div>
          ))}
        </div>
      )}

      {/* CxC/CxP NO llevan rango de fechas a propósito: una deuda vieja no puede desaparecer
          del listado por un filtro que el dueño no ha puesto. Sí buscan por texto, así que
          la barra sale sin píldoras de fecha y con buscador. */}
      {data.documentos.length > 0 && (
        <Filtros
          filtros={declaracion}
          q={busca}
          placeholder="Buscar por documento, tercero o importe…"
          visibles={3}
          onCargando={setCargando}
        />
      )}

      {/* Tabla */}
      <TablaCargando activo={cargando}>
      <div className="card card-table">
        {documentos.length === 0 ? (
          <div className="mon-empty">
            <Check size={40} strokeWidth={1} opacity={0.2} />
            <p>{data.documentos.length === 0
              ? (esCobro ? 'No hay nada pendiente de cobro. Todo al día.' : 'No hay nada pendiente de pago. Todo al día.')
              : 'No hay documentos para los filtros seleccionados.'}</p>
          </div>
        ) : (
          <div className="table-wrapper">
            <table className="table">
              <thead>
                <tr>
                  <th>Documento</th>
                  <th>{esCobro ? 'Cliente' : 'Proveedor'}</th>
                  <th>Vencimiento</th>
                  <th className="col-num">Total</th>
                  <th className="col-num">Pendiente</th>
                  <th className="col-actions"></th>
                </tr>
              </thead>
              <tbody>
                {pageItems.map(d => {
                  const abierto = detalle === d.doc_id
                  return (
                  <Fragment key={d.doc_id}>
                  <tr
                    className={multiempresa ? 'row-empresa-accent' : undefined}
                    style={multiempresa ? empresaColorVar(colorOf(d.empresa_id)) : undefined}
                  >
                    <td data-label="Documento">
                      <strong>{d.numero}</strong>
                      <div className="tes-mov-sub">
                        <span className="badge badge-neutral tes-origen-badge">{d.doc_tipo === 'FACTURA' ? 'Factura' : 'Directo'}</span>
                        <span className="tes-mov-cat">{formatFecha(d.fecha)}</span>
                        {multiempresa && (
                          <EmpresaTag color={colorOf(d.empresa_id)} nombre={nombreOf(d.empresa_id) ?? d.empresa_id} />
                        )}
                      </div>
                    </td>
                    <td data-label={esCobro ? 'Cliente' : 'Proveedor'} className="text-sm-muted">{d.tercero_nombre ?? '—'}</td>
                    <td data-label="Vencimiento" className="tes-nowrap">
                      {formatFecha(d.vencimiento)}
                      {d.dias_vencido != null && (
                        <span className={`badge ${TRAMO_BADGE[d.tramo]} cxx-dias`}>{d.dias_vencido} d</span>
                      )}
                    </td>
                    <td data-label="Total" className="col-num tes-monto-cell">{formatMonto(d.monto)} {d.moneda}</td>
                    <td data-label="Pendiente" className="col-num tes-monto-cell">{formatMonto(d.saldo)} {d.moneda}</td>
                    <td className="col-actions">
                      <div className="ter-actions">
                        <button type="button" className="ter-action-btn" title="Ver detalle"
                          aria-label={`Ver detalle de ${d.numero}`} aria-expanded={abierto}
                          onClick={() => setDetalle(abierto ? null : d.doc_id)}>
                          <ChevronDown size={15} strokeWidth={2} className={abierto ? 'tes-chevron-abierto' : undefined} />
                        </button>
                        {(puedeEditar || (d.ref_url && d.doc_tipo === 'FACTURA')) && (
                          <RowActions>
                            {puedeEditar && (
                              <button className="row-actions-item"
                                onClick={() => setPagoDoc(d)}><DollarSign size={15} strokeWidth={2} /> {esCobro ? 'Cobrar' : 'Pagar'}</button>
                            )}
                            {d.ref_url && d.doc_tipo === 'FACTURA' && (
                              <Link className="row-actions-item" href={d.ref_url}><ExternalLink size={15} strokeWidth={2} /> Ver factura</Link>
                            )}
                          </RowActions>
                        )}
                      </div>
                    </td>
                  </tr>
                  {abierto && (
                    <tr className="tes-mov-detalle-fila">
                      <td colSpan={6}>
                        <dl className="tes-mov-detalle">
                          {multiempresa && <div><dt>Empresa</dt><dd>{nombreOf(d.empresa_id) ?? '—'}</dd></div>}
                          <div><dt>Documento</dt><dd>{d.doc_tipo === 'FACTURA' ? 'Factura' : 'Registro directo'}</dd></div>
                          <div><dt>{esCobro ? 'Cliente' : 'Proveedor'}</dt><dd>{d.tercero_nombre ?? '—'}</dd></div>
                          <div><dt>Fecha</dt><dd>{formatFecha(d.fecha)}</dd></div>
                          <div><dt>Vencimiento</dt><dd>{formatFecha(d.vencimiento)}{d.dias_vencido != null ? ` · ${d.dias_vencido} d vencida` : ''}</dd></div>
                          <div><dt>Total</dt><dd>{formatMonto(d.monto)} {d.moneda}</dd></div>
                          <div><dt>Cobrado / pagado</dt><dd>{formatMonto(d.liquidado)} {d.moneda}</dd></div>
                          <div><dt>Pendiente</dt><dd>{formatMonto(d.saldo)} {d.moneda}</dd></div>
                          {d.liquidaciones.length > 0 && (
                            <div className="tes-mov-detalle-ancho">
                              <dt>{esCobro ? 'Cobros registrados' : 'Pagos registrados'}</dt>
                              <dd>
                                <ul className="gc-detalle-liq">
                                  {d.liquidaciones.map(l => (
                                    <li key={l.movimiento_id}>
                                      <span className="text-sm-muted tes-nowrap">{formatFecha(l.fecha)}</span>
                                      <span className="cell-clamp">{l.cuenta_nombre}</span>
                                      <span className="gc-liq-monto">{formatMonto(l.monto)} {d.moneda}</span>
                                    </li>
                                  ))}
                                </ul>
                              </dd>
                            </div>
                          )}
                        </dl>
                      </td>
                    </tr>
                  )}
                  </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
        <TablePagination {...pag} label="documento" />
      </div>
      </TablaCargando>

      {pagoVivo && (
        <PagoModal doc={pagoVivo} cuentas={data.cuentas} modo={data.modo}
          empresaNombres={data.empresa_nombres}
          onClose={() => setPagoDoc(null)} onChanged={onChanged} />
      )}
    </div>
  )
}

