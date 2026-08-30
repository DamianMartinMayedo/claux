import { requireAccesoPagina } from '@/lib/admin-guard'
import { Archive, ChevronRight, Clock, CreditCard } from 'lucide-react'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import AccionesHeader from './AccionesHeader'
import AccesoUsuariosCard from './AccesoUsuariosCard'
import ModulosCard from './ModulosCard'
import CondicionesCard from './CondicionesCard'
import CapacidadCard from './CapacidadCard'
import IaClienteCard from './IaClienteCard'
import UsoClienteCard from './UsoClienteCard'
import PresupuestosClienteCard from './PresupuestosClienteCard'
import DocumentosClienteCard, { DOCS as DOCS_LEGALES } from './DocumentosClienteCard'
import ClienteTabs from './ClienteTabs'
import PagosClienteTabla, { type PagoFicha } from './PagosClienteTabla'
import { ESTADO_BADGE } from '@/lib/badges'
import { puedeAcceder } from '@/lib/roles'
import { getSetting } from '@/app/actions/settings'
import { suscripcionLabel, precioMensualEfectivo, esSocioHoy, monedaDelCliente } from '@/lib/billing'
import { nombresDeNiveles } from '@/lib/niveles-server'
import { listarFirmasCliente } from '@/app/actions/documentos-admin'
import { COLUMNAS_PRECIO, normalizarNivel } from '@/lib/niveles'
import { importeClaux, normalizarMonedaClaux, type MonedaClaux } from '@/lib/moneda-claux'

function periodoIa(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Havana', year: 'numeric', month: '2-digit' })
    .format(new Date()).slice(0, 7)
}

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

/**
 * Cobrado por moneda, NUNCA sumado entre ellas: $100 y €100 no hacen 200 de nada,
 * y el cliente puede pagar en una un mes y en la otra al siguiente. Devuelve solo
 * las monedas con movimiento, de mayor a menor.
 */
function sumarPorMoneda(
  filas: { monto: number | null; moneda: string | null }[],
): [MonedaClaux, number][] {
  const acc = new Map<MonedaClaux, number>()
  for (const f of filas) {
    const m = normalizarMonedaClaux(f.moneda)
    acc.set(m, (acc.get(m) ?? 0) + (Number(f.monto) || 0))
  }
  return [...acc].filter(([, v]) => v !== 0).sort((a, b) => b[1] - a[1])
}

const listaImportes = (t: [MonedaClaux, number][], vacio: MonedaClaux) =>
  t.length ? t.map(([m, v]) => importeClaux(v, m)).join(' · ') : importeClaux(0, vacio)

function formatFecha(fecha: string | null | undefined) {
  if (!fecha) return '—'
  const [y, m, d] = fecha.split('T')[0].split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' })
}

export default async function ClienteDetallePage({
  params,
  searchParams,
}: {
  params: Promise<{ client_id: string }>
  searchParams: Promise<{ [k: string]: string | string[] | undefined }>
}) {
  // La ficha se abre con el permiso de Clientes, pero sus tarjetas actúan sobre
  // Presupuestos y Pagos: sin sus llaves, se enseñan pero no se tocan (las acciones
  // del servidor lo comprueban igual; esto es para no ofrecer lo que va a fallar).
  const ctx = await requireAccesoPagina('clientes')
  const puedePresupuestos = puedeAcceder(ctx, 'presupuestos')
  const puedePagos        = puedeAcceder(ctx, 'pagos')
  const { client_id } = await params
  const sp = await searchParams
  const tabPedida = typeof sp.tab === 'string' ? sp.tab : undefined
  const supabase = await createClient()

  const [{ data: cliente }, { data: pagos }, { data: catalogo }, { data: usuarios }, { data: presupuestosOk }, nombresNivel, firmas] = await Promise.all([
    supabase.from('clients').select('*').eq('client_id', client_id).single(),
    supabase
      .from('payments')
      .select('*')
      .eq('client_id', client_id)
      .order('fecha', { ascending: false }),
    supabase
      .from('modulos_catalogo')
      .select(`clave, nombre, descripcion, ${COLUMNAS_PRECIO}, es_base, tipo`)
      .eq('activo', true)
      .order('orden'),
    supabase
      .from('client_users')
      .select('user_id, email, nombre, rol, estado, created_at')
      .eq('client_id', client_id)
      .order('created_at'),
    // Presupuestos APROBADOS: son la vara con la que se mide el cobro de
    // configuración pendiente (un borrador todavía no es un acuerdo).
    supabase
      .from('presupuestos_instalacion')
      .select('id, total_final, moneda')
      .eq('client_id', client_id)
      .in('estado', ['aprobado', 'instalado'])
      .order('created_at', { ascending: false }),
    nombresDeNiveles(),
    listarFirmasCliente(client_id),
  ])

  if (!cliente) notFound()

  const descuentoAnual = parseInt(await getSetting('descuento_anual_pct', '10'), 10) || 0
  // Lo que se le cobra (catálogo menos lo pactado; cero si es Socio CLAUX). `select('*')`
  // ya trae las columnas de condiciones, así que no hace falta otra consulta.
  // La moneda en la que se le factura HOY. Manda sobre qué caché se mira y en qué
  // nace su próximo cobro; lo ya cobrado conserva la suya (ver `sumarPorMoneda`).
  const moneda      = monedaDelCliente(cliente)
  const precioMes   = precioMensualEfectivo(cliente)
  const suscripcion = suscripcionLabel(precioMes, cliente.ciclo_facturacion ?? 'mensual', descuentoAnual, moneda)
  const cuotaCatalogo = Number((moneda === 'EUR' ? cliente.precio_mensual_eur : cliente.precio_mensual_usd) ?? 0) || 0
  const confirmados = (pagos ?? []).filter(p => p.estado !== 'por_confirmar')
  const totalPagado = sumarPorMoneda(confirmados)
  const pendienteConfirmar = sumarPorMoneda((pagos ?? []).filter(p => p.estado === 'por_confirmar'))
  const ultimoPago  = confirmados[0] ?? null
  // Lo que espera en cada pestaña. Son los únicos números que se pintan en las
  // solapas: si no hay nada pendiente no hay número (ver `ClienteTabs`).
  const pagosPorConfirmar = (pagos ?? []).filter(p => p.estado === 'por_confirmar').length
  const tiposFirmados = new Set(firmas.map(f => f.tipo))
  const docsPendientes = DOCS_LEGALES.filter(d => !tiposFirmados.has(d.tipo)).length
  const presupuestosRef = (presupuestosOk ?? []).map(p => ({
    id: p.id as number, total: Number(p.total_final) || 0,
    moneda: normalizarMonedaClaux(p.moneda),
  }))
  const tieneGracia = cliente.estado === 'GRACIA' && cliente.fecha_fin_gracia
  const socioVigente = esSocioHoy(cliente)

  // Datos de IA (solo si el cliente tiene el addon contratado).
  const tieneIa = Array.isArray(cliente.modulos_activos) && cliente.modulos_activos.includes('asistente_ia')
  let iaData: { cupoNivel: number; cupoOverride: number | null; conversaciones: number; tokens: number } | null = null
  if (tieneIa) {
    // El cupo base lo fija el NIVEL; el global de settings queda de red de
    // seguridad por si ese nivel no tuviera fila. Mismo orden que `cupoEfectivo`
    // en lib/ia/modelo.ts, que es quien lo aplica de verdad al elegir modelo.
    const { data: filaIa } = await supabase.from('nivel_limites')
      .select('base').eq('nivel', normalizarNivel(cliente.nivel)).eq('dimension', 'ia_conversaciones').maybeSingle()
    const cupoNivel = filaIa && filaIa.base !== null
      ? Math.floor(Number(filaIa.base))
      : parseInt(await getSetting('ia_cupo_conversaciones', '500'), 10) || 500
    const { data: uso } = await supabase
      .from('ia_uso').select('conversaciones, tokens_in, tokens_out')
      .eq('client_id', client_id).eq('periodo', periodoIa()).maybeSingle()
    const cfg = (cliente.ia_config && typeof cliente.ia_config === 'object') ? cliente.ia_config as Record<string, unknown> : {}
    const ov = Number(cfg.cupo)
    iaData = {
      cupoNivel,
      cupoOverride: Number.isFinite(ov) && ov > 0 ? Math.floor(ov) : null,
      conversaciones: Number(uso?.conversaciones) || 0,
      tokens: (Number(uso?.tokens_in) || 0) + (Number(uso?.tokens_out) || 0),
    }
  }

  return (
    <div className="view-container detail-page">

      {/* ── Breadcrumb ── */}
      <nav className="breadcrumb" aria-label="Ruta de navegación">
        <Link href="/admin/clientes">Clientes</Link>
        <ChevronRight className="breadcrumb-sep" />
        <span className="breadcrumb-current">{cliente.nombre_empresa}</span>
      </nav>

      {/* ── Header con título + badges (izquierda) y acciones (derecha) ── */}
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
            {cliente.es_prueba && <span className="badge badge-purple">Prueba</span>}
          </div>
        </div>
        <div className="detail-header-buttons">
          {/* Orden acordado: Editar, Suspender/Reactivar, Período especial, Registrar pago */}
          <AccionesHeader
            cliente={{
              client_id:        cliente.client_id,
              nombre_empresa:   cliente.nombre_empresa,
              estado:           cliente.estado,
              fecha_expiracion: cliente.fecha_expiracion,
              es_socio:         cliente.es_socio === true,
              socio_hasta:      cliente.socio_hasta ?? null,
              nombre_contacto:  cliente.nombre_contacto,
              email_admin:      cliente.email_admin,
              notas:            cliente.notas,
              archivado_at:     cliente.archivado_at,
              es_prueba:        cliente.es_prueba,
              autoimport_activo: cliente.autoimport_activo,
              migracion_estado:  cliente.migracion_estado,
            }}
            tienePagosConfirmados={confirmados.length > 0}
          />
        </div>
      </div>

      {/* ── Banner archivado ── */}
      {cliente.archivado_at && (
        <div className="info-banner">
          <Archive aria-hidden />
          <div>
            <strong>Cliente archivado</strong>
            <span>Oculto de las listas activas. Todos sus datos se conservan; puedes desarchivarlo desde las acciones.</span>
          </div>
        </div>
      )}

      {/* ── Banner período especial ── */}
      {tieneGracia && (
        <div className="info-banner info-banner-gracia">
          <Clock aria-hidden />
          <div>
            <strong>Período especial activo</strong>
            {/* Una línea por dato, sin `<strong>` en medio de la frase: la regla
                `.info-banner strong` es `display:block` (la necesitan los banners
                que van en un `<p>`), así que un bold incrustado partía la frase y
                dejaba la fecha suelta en su propio renglón. */}
            <span>Motivo: {MOTIVOS_GRACIA[cliente.motivo_gracia] ?? cliente.motivo_gracia}</span>
            <span>Válido hasta el {formatFecha(cliente.fecha_fin_gracia)}</span>
            {/* Los dos relojes a la vez. Sin esta línea la ficha enseña una fecha de
                corte que no corta, y quien la lee cree que este cliente se queda
                fuera ese día. La condición de socio manda por encima; el período
                especial es de antes de marcarlo y ya no sostiene nada. */}
            {socioVigente && (
              <span className="info-note">
                Su acceso ya no depende de esta fecha: es Socio CLAUX
                {cliente.socio_hasta ? ` hasta el ${formatFecha(cliente.socio_hasta)}` : ' por tiempo indefinido'},
                y mientras lo sea no se le corta el acceso ni se le cobra. Cuando termine
                esa condición vuelve a mandar el vencimiento normal.
              </span>
            )}
            {cliente.notas_gracia && (
              <span className="info-note">
                {cliente.notas_gracia}
              </span>
            )}
          </div>
        </div>
      )}

      <ClienteTabs
        tabInicial={tabPedida}
        pagosPendientes={pagosPorConfirmar}
        docsPendientes={docsPendientes}
        resumen={
          <>
          {/* ── Información del cliente (ancho completo, grid horizontal) ── */}
          <div className="card">
            <h2 className="detail-section-title">Información del cliente</h2>

            <div className="detail-info-grid">
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
            </div>

            {cliente.notas && (
              <div className="detail-field mt-4">
                <span className="detail-field-label">Notas internas</span>
                <span className="detail-field-value">{cliente.notas}</span>
              </div>
            )}
          </div>

          {/* ── Uso y actividad del cliente ── */}
          <UsoClienteCard clientId={client_id} />
          </>
        }
        cuota={
          <>
          {/* ── Módulos contratados ── */}
          {catalogo && catalogo.length > 0 && (
            <ModulosCard
              client_id={client_id}
              modulosActivos={Array.isArray(cliente.modulos_activos) ? cliente.modulos_activos : []}
              nivel={cliente.nivel}
              nombresNivel={nombresNivel}
              moneda={moneda}
              ciclo={cliente.ciclo_facturacion ?? 'mensual'}
              precioMensual={cuotaCatalogo}
              descuentoAnualPct={descuentoAnual}
              catalogo={catalogo}
            />
          )}

          {/* ── Lo pactado: descuento sobre la cuota y Socio CLAUX ── */}
          <CondicionesCard
            clientId={client_id}
            precioCatalogo={cuotaCatalogo}
            moneda={moneda}
            descuentoPct={Number(cliente.descuento_pct ?? 0) || 0}
            descuentoDesde={cliente.descuento_desde ?? null}
            descuentoHasta={cliente.descuento_hasta ?? null}
            descuentoMotivo={cliente.descuento_motivo ?? null}
            esSocio={cliente.es_socio === true}
            socioHasta={cliente.socio_hasta ?? null}
            socioMotivo={cliente.socio_motivo ?? null}
          />

          {/* ── Cuánto le cabe en su nivel y cuánto lleva ── */}
          <CapacidadCard
            clientId={client_id}
            nivelNombre={nombresNivel[normalizarNivel(cliente.nivel)]}
            limitesOverride={cliente.limites_override ?? null}
          />

          {/* ── Asistente IA (solo con el addon contratado) ── */}
          {iaData && (
            <IaClienteCard
              clientId={client_id}
              cupoNivel={iaData.cupoNivel}
              nivelNombre={nombresNivel[normalizarNivel(cliente.nivel)]}
              cupoOverride={iaData.cupoOverride}
              conversaciones={iaData.conversaciones}
              tokens={iaData.tokens}
              periodo={periodoIa()}
            />
          )}
          </>
        }
        pagos={
          <>
          {/* ── Grid 2 columnas: Historial de pagos (izq) + Resumen de pagos (der) ── */}
          <div className="detail-grid">

            {/* Historial de pagos */}
            <div className="card">
              <div className="card-header">
                <h2 className="card-title">Historial de pagos</h2>
                <span className="badge badge-neutral">
                  {pagos?.length ?? 0} pago{pagos?.length !== 1 ? 's' : ''}
                </span>
              </div>

              {!pagos || pagos.length === 0 ? (
                <div className="table-empty table-empty-sm">
                  <CreditCard size={36} strokeWidth={1.5} />
                  <p>Sin pagos registrados aún.</p>
                </div>
              ) : (
                <PagosClienteTabla
                  pagos={pagos as PagoFicha[]}
                  clienteNombre={cliente.nombre_empresa ?? client_id}
                  presupuestos={presupuestosRef}
                  puedeGestionar={puedePagos}
                />
              )}
            </div>

            {/* Resumen de pagos */}
            <div className="card">
              <h2 className="detail-section-title">Resumen de pagos</h2>

              <div className="detail-field">
                <span className="detail-field-label">Total cobrado (confirmado)</span>
                <span className="detail-field-value detail-field-value-large">
                  {listaImportes(totalPagado, moneda)}
                </span>
              </div>
              {pendienteConfirmar.length > 0 && (
                <div className="detail-field">
                  <span className="detail-field-label">Pendiente por confirmar</span>
                  <span className="detail-field-value">
                    {pendienteConfirmar.map(([m, v]) => (
                      <span key={m} className="badge badge-warning">{importeClaux(v, m)}</span>
                    ))}
                  </span>
                </div>
              )}
              <div className="detail-field">
                <span className="detail-field-label">Último pago</span>
                <span className="detail-field-value">
                  {ultimoPago ? (
                    <span className="pago-detalle-stack">
                      <span><strong>{importeClaux(ultimoPago.monto, ultimoPago.moneda)}</strong> · {METODO_LABEL[ultimoPago.metodo] ?? ultimoPago.metodo}</span>
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

          {/* ── Presupuestos de este cliente (y la puerta para hacerle uno nuevo) ── */}
          {/* Sin la llave de Presupuestos la tarjeta no se pinta: sus datos los sirve una
              acción gateada, así que sin permiso no hay ni lectura que enseñar. */}
          {puedePresupuestos && (
            <PresupuestosClienteCard
              clientId={client_id}
              nombreEmpresa={cliente.nombre_empresa ?? client_id}
              tienePagoConfiguracion={(pagos ?? []).some(p => p.concepto === 'configuracion')}
              catalogo={catalogo ?? []}
              nombresNivel={nombresNivel}
              descuentoAnualPct={descuentoAnual}
            />
          )}
          </>
        }
        acceso={
          <>
          {/* ── Acceso y usuarios del cliente (regenerar contraseñas) ── */}
          <AccesoUsuariosCard clientId={client_id} usuarios={usuarios ?? []} />

          {/* ── Documentos legales (NDA, contrato, presupuesto) ── */}
          <DocumentosClienteCard clientId={client_id} firmas={firmas} />
          </>
        }
      />

    </div>
  )
}
