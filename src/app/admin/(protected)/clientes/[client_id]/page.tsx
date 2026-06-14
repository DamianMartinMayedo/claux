import { notFound } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import AccionesDetalle from './AccionesDetalle'
import EditarClienteModal from './EditarClienteModal'
import ModulosCard from './ModulosCard'
import ConfirmarPagoBtn from '../../pagos/ConfirmarPagoBtn'
import { ESTADO_BADGE } from '@/lib/badges'
import { getSetting } from '@/app/actions/settings'
import { suscripcionLabel } from '@/lib/billing'

const METODO_LABEL: Record<string, string> = {
  tropipay:      'TropiPay',
  transferencia: 'Transferencia',
  efectivo:      'Efectivo',
}

const MOTIVOS_GRACIA: Record<string, string> = {
  descuento: 'Descuento comercial',
  promocion: 'Promoción',
  oferta:    'Oferta especial',
  cortesia:  'Cortesía',
  liquidez:  'Problema de liquidez',
  otro:      'Otro',
}

function formatFecha(fecha: string | null | undefined) {
  if (!fecha) return '—'
  // Parseo seguro sin desfase de timezone (YYYY-MM-DD → no usar new Date(str) directamente)
  const [y, m, d] = fecha.split('T')[0].split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' })
}

export default async function ClienteDetallePage({
  params,
}: {
  params: Promise<{ client_id: string }>
}) {
  const { client_id } = await params
  const supabase = await createClient()

  const [{ data: cliente }, { data: pagos }, { data: catalogo }] = await Promise.all([
    supabase.from('clients').select('*').eq('client_id', client_id).single(),
    supabase
      .from('payments')
      .select('*')
      .eq('client_id', client_id)
      .order('fecha', { ascending: false }),
    supabase
      .from('modulos_catalogo')
      .select('clave, nombre, descripcion, precio_fundador_usd, precio_estandar_usd, es_base, tipo')
      .eq('activo', true)
      .order('orden'),
  ])

  if (!cliente) notFound()

  const descuentoAnual = parseInt(await getSetting('descuento_anual_pct', '10'), 10) || 0
  const precioMes   = Number(cliente.precio_mensual_usd ?? 0)
  const suscripcion = suscripcionLabel(precioMes, cliente.ciclo_facturacion ?? 'mensual', descuentoAnual)
  const confirmados = (pagos ?? []).filter(p => p.estado !== 'por_confirmar')
  const totalPagado = confirmados.reduce((sum, p) => sum + (p.monto_usd ?? 0), 0)
  const pendienteConfirmar = (pagos ?? [])
    .filter(p => p.estado === 'por_confirmar')
    .reduce((sum, p) => sum + (p.monto_usd ?? 0), 0)
  const ultimoPago  = confirmados[0] ?? null
  const tieneGracia = cliente.estado === 'GRACIA' && cliente.fecha_fin_gracia

  return (
    <div className="view-container">

      {/* ── Breadcrumb ── */}
      <nav className="breadcrumb" aria-label="Ruta de navegación">
        <Link href="/admin/clientes">Clientes</Link>
        <svg className="breadcrumb-sep" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <polyline points="9 18 15 12 9 6"/>
        </svg>
        <span className="breadcrumb-current">{cliente.nombre_empresa}</span>
      </nav>

      {/* ── Header ── */}
      <div className="detail-header">
        <div className="detail-header-info">
          <h1 className="page-title">{cliente.nombre_empresa}</h1>
          <div className="detail-badges">
            <span className="badge badge-neutral">
              {suscripcion}
            </span>
            <span className={`badge badge-dot ${ESTADO_BADGE[cliente.estado] ?? 'badge-neutral'}`}>
              {cliente.estado}
            </span>
          </div>
        </div>
        <EditarClienteModal cliente={{
          client_id:       cliente.client_id,
          nombre_empresa:  cliente.nombre_empresa,
          nombre_contacto: cliente.nombre_contacto,
          email_admin:     cliente.email_admin,
          notas:           cliente.notas,
        }} />
      </div>

      {/* ── Barra de acciones (Client Component) ── */}
      <AccionesDetalle
        cliente={{
          client_id:        cliente.client_id,
          nombre_empresa:   cliente.nombre_empresa,
          estado:           cliente.estado,
          fecha_expiracion: cliente.fecha_expiracion,
        }}
      />

      {/* ── Banner período especial ── */}
      {tieneGracia && (
        <div className="info-banner info-banner-gracia">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
          </svg>
          <div>
            <strong>Período especial activo</strong>
            <span>
              Motivo: {MOTIVOS_GRACIA[cliente.motivo_gracia] ?? cliente.motivo_gracia}
              {' · '}Válido hasta: <strong>{formatFecha(cliente.fecha_fin_gracia)}</strong>
            </span>
            {cliente.notas_gracia && (
              <span className="info-note">
                {cliente.notas_gracia}
              </span>
            )}
          </div>
        </div>
      )}

      {/* ── Grid de datos ── */}
      <div className="detail-grid">

        {/* Información del cliente */}
        <div className="card">
          <h2 className="detail-section-title">Información del cliente</h2>

          <div className="detail-field">
            <span className="detail-field-label">Email administrador</span>
            <span className="detail-field-value">{cliente.email_admin}</span>
          </div>
          <div className="detail-field">
            <span className="detail-field-label">Nombre de contacto</span>
            <span className="detail-field-value">{cliente.nombre_contacto || '—'}</span>
          </div>
          <div className="detail-field">
            <span className="detail-field-label">Suscripción</span>
            <span className="detail-field-value">
              {suscripcion}
            </span>
          </div>
          <div className="detail-field">
            <span className="detail-field-label">Estado</span>
            <span className="detail-field-value">
              <span className={`badge badge-dot ${ESTADO_BADGE[cliente.estado] ?? 'badge-neutral'}`}>
                {cliente.estado}
              </span>
            </span>
          </div>
          <div className="detail-field">
            <span className="detail-field-label">Fecha de alta</span>
            <span className="detail-field-value">
              {formatFecha(cliente.fecha_inicio ?? cliente.created_at)}
            </span>
          </div>
          <div className="detail-field">
            <span className="detail-field-label">Expiración</span>
            <span className="detail-field-value">{formatFecha(cliente.fecha_expiracion)}</span>
          </div>
          {cliente.notas && (
            <div className="detail-field">
              <span className="detail-field-label">Notas internas</span>
              <span className="detail-field-value">{cliente.notas}</span>
            </div>
          )}
        </div>

        {/* Resumen de pagos */}
        <div className="card">
          <h2 className="detail-section-title">Resumen de pagos</h2>

          <div className="detail-field">
            <span className="detail-field-label">Total cobrado (confirmado)</span>
            <span className="detail-field-value detail-field-value-large">
              ${totalPagado.toFixed(2)} USD
            </span>
          </div>
          {pendienteConfirmar > 0 && (
            <div className="detail-field">
              <span className="detail-field-label">Pendiente por confirmar</span>
              <span className="detail-field-value">
                <span className="badge badge-warning">${pendienteConfirmar.toFixed(2)} USD</span>
              </span>
            </div>
          )}
          <div className="detail-field">
            <span className="detail-field-label">Último pago</span>
            <span className="detail-field-value">
              {ultimoPago ? (
                <span className="pago-detalle-stack">
                  <span><strong>${ultimoPago.monto_usd?.toFixed(2)} USD</strong> · {METODO_LABEL[ultimoPago.metodo] ?? ultimoPago.metodo}</span>
                  <span className="text-xs-muted">
                    Registrado: {formatFecha(ultimoPago.fecha)}
                  </span>
                  {ultimoPago.fecha_inicio_periodo && ultimoPago.fecha_fin_periodo && (
                    <span className="text-xs-muted">
                      Período: {formatFecha(ultimoPago.fecha_inicio_periodo)} → {formatFecha(ultimoPago.fecha_fin_periodo)}
                    </span>
                  )}
                </span>
              ) : '—'}
            </span>
          </div>
          <div className="detail-field">
            <span className="detail-field-label">Método preferido</span>
            <span className="detail-field-value">
              {ultimoPago ? (METODO_LABEL[ultimoPago.metodo] ?? ultimoPago.metodo ?? '—') : '—'}
            </span>
          </div>
          <div className="detail-field">
            <span className="detail-field-label">Número de pagos</span>
            <span className="detail-field-value">{pagos?.length ?? 0}</span>
          </div>
        </div>

      </div>

      {/* ── Módulos contratados ── */}
      {catalogo && catalogo.length > 0 && (
        <ModulosCard
          client_id={client_id}
          modulosActivos={Array.isArray(cliente.modulos_activos) ? cliente.modulos_activos : []}
          tarifa={cliente.tarifa ?? 'estandar'}
          ciclo={cliente.ciclo_facturacion ?? 'mensual'}
          precioMensual={Number(cliente.precio_mensual_usd ?? 0)}
          descuentoAnualPct={descuentoAnual}
          catalogo={catalogo}
        />
      )}

      {/* ── Historial de pagos ── */}
      <div className="card">
        <div className="card-header">
          <h2 className="card-title">Historial de pagos</h2>
          <span className="badge badge-neutral">
            {pagos?.length ?? 0} pago{pagos?.length !== 1 ? 's' : ''}
          </span>
        </div>

        {!pagos || pagos.length === 0 ? (
          <div className="table-empty table-empty-sm">
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/>
            </svg>
            <p>Sin pagos registrados aún.</p>
          </div>
        ) : (
          <div className="table-wrapper table-wrapper-flush">
            <table className="table">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Monto</th>
                  <th>Concepto</th>
                  <th>Estado</th>
                  <th>Método</th>
                  <th>Período cubierto</th>
                  <th>Notas</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {pagos.map(p => (
                  <tr key={p.pago_id}>
                    <td className="table-muted">{formatFecha(p.fecha)}</td>
                    <td className="table-price">${p.monto_usd?.toFixed(2)}</td>
                    <td>
                      <span className={`badge ${p.concepto === 'configuracion' ? 'badge-info' : 'badge-neutral'}`}>
                        {p.concepto === 'configuracion' ? 'Configuración' : 'Suscripción'}
                      </span>
                    </td>
                    <td>
                      <span className={`badge ${p.estado === 'por_confirmar' ? 'badge-warning' : 'badge-success'}`}>
                        {p.estado === 'por_confirmar' ? 'Por confirmar' : 'Confirmado'}
                      </span>
                    </td>
                    <td>
                      <span className="badge badge-neutral">
                        {METODO_LABEL[p.metodo] ?? p.metodo ?? '—'}
                      </span>
                    </td>
                    <td className="table-muted text-xs">
                      {p.fecha_inicio_periodo && p.fecha_fin_periodo
                        ? `${formatFecha(p.fecha_inicio_periodo)} → ${formatFecha(p.fecha_fin_periodo)}`
                        : '—'}
                    </td>
                    <td className="table-muted td-notes">
                      {p.notas ?? '—'}
                    </td>
                    <td className="table-actions-right">
                      {p.estado === 'por_confirmar' && (
                        <ConfirmarPagoBtn
                          pagoId={p.pago_id}
                          clienteNombre={cliente.nombre_empresa}
                          monto={p.monto_usd ?? 0}
                          concepto={p.concepto}
                        />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

    </div>
  )
}
