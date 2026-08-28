'use client'

import type { FacturacionData } from '@/app/actions/portal/facturacion'
import { useState, useTransition } from 'react'
import { Receipt, ArrowRight, Check, TrendingUp } from 'lucide-react'
import { usePagination, TablePagination } from '@/components/TablePagination'
import { registrarInteresModulo } from '@/app/actions/portal/soporte'
import { useNotificacionesOpcional } from '@/components/portal/notificaciones/NotificacionesContext'
import { toastError, toastSuccess } from '@/app/contexts/ToastContext'

// La clave con la que «subir de nivel» viaja por el circuito de contratación.
// Es la MISMA que usa el banner del dashboard (`OFERTA_NIVEL` de `@/lib/limites`),
// y no se importa de allí porque ese módulo arrastra el cliente de servidor: aquí
// solo hace falta la cadena. Si cambia, cambia en los dos sitios.
const CLAVE_NIVEL = 'nivel_superior'

// ── Helpers ───────────────────────────────────────────────────────────────────

const ESTADO_LABEL: Record<string, string> = {
  ACTIVO:     'Activo',
  TRIAL:      'Período de prueba',
  GRACIA:     'Prórroga',
  VENCIDO:    'Vencido',
  DESACTIVADO: 'Desactivado',
}

const METODO_LABEL: Record<string, string> = {
  tropipay:      'TropiPay',
  transferencia: 'Transferencia',
  efectivo:      'Efectivo',
}

function fmt(dateStr: string | null | undefined) {
  if (!dateStr) return '—'
  return new Date(dateStr + 'T12:00:00').toLocaleDateString('es-ES', {
    day: '2-digit', month: 'short', year: 'numeric',
  })
}

function fmtUsd(amount: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount)
}

function diasRestantes(fechaStr: string | null): number | null {
  if (!fechaStr) return null
  const diff = new Date(fechaStr + 'T23:59:59').getTime() - Date.now()
  return Math.ceil(diff / 86_400_000)
}

// ── Vista principal ───────────────────────────────────────────────────────────

export default function FacturacionView({ data }: { data: FacturacionData }) {
  const { pageItems, ...pag } = usePagination(data.pagos)

  // Arranca con lo que YA pidió (viene del servidor): si vive solo en memoria, al
  // recargar vuelve a decir «lo quiero» y el dueño no sabe si su clic sirvió.
  const [pedido, setPedido]     = useState<string | null>(data.nivel_pedido_el)
  const [enviando, setEnviando] = useState(false)
  const [, startTransition]     = useTransition()
  // La campana solo se refresca al volver a la pestaña (throttle de 60 s): sin
  // esto el acuse existe en BD pero no aparece hasta más tarde, que para el dueño
  // es lo mismo que no existir.
  const notificaciones = useNotificacionesOpcional()

  function pedirNivel(nombre: string) {
    if (enviando || pedido) return
    setEnviando(true)
    startTransition(async () => {
      const r = await registrarInteresModulo(CLAVE_NIVEL, `el nivel ${nombre}`)
      setEnviando(false)
      if (!r.ok) { toastError(r.error ?? 'No se pudo enviar.'); return }
      setPedido('ahora')
      toastSuccess('Recibido. Te contactamos enseguida.')
      void notificaciones?.refrescar()
    })
  }

  // Lo que aún no ha entrado. Se suma sobre TODOS los pagos, no sobre la página
  // visible: el cliente tiene que ver lo que debe aunque esté en la página 3.
  const pendiente = data.pagos
    .filter(p => p.estado === 'por_confirmar')
    .reduce((total, p) => total + Number(p.monto_usd ?? 0), 0)

  // En GRACIA, lo vigente es `fecha_fin_gracia` — la suscripción de base ya venció
  // (por eso el cliente está en gracia) y seguir mirando `fecha_expiracion` es lo
  // que hacía salir "Expirado" con el acceso todavía activo.
  const enGracia = data.estado === 'GRACIA' && !!data.fecha_fin_gracia
  // Y en SOCIO manda `socio_hasta`, por delante de todo lo demás: a un socio le
  // hemos dicho que no pague, así que su `fecha_expiracion` —hasta cuándo pagó—
  // se quedó atrás a propósito y enseñarla decía «Expirado» a alguien que tiene
  // el portal entero. Es la tercera vez que asoma el mismo fallo (gracia, prueba
  // y ahora socio): la fecha que se pinta es la que MANDA, no la de cobro.
  const fechaVigencia =
    data.es_socio ? data.socio_hasta :
    enGracia      ? data.fecha_fin_gracia :
                    data.fecha_expiracion
  // El entorno de PRUEBA no vence nunca (coherente con el layout y la pantalla de bloqueo):
  // sin esto, un cliente de prueba con `fecha_expiracion` en el pasado veía un falso «Expirado».
  // El socio sin fecha tampoco: su condición es indefinida hasta que se le ponga uno.
  const sinCaducidad = data.es_prueba || (data.es_socio && !data.socio_hasta)
  const dias = sinCaducidad ? null : diasRestantes(fechaVigencia)

  const diasCls =
    dias === null         ? ''                :
    dias <= 0             ? 'fac-dias-venc'   :
    dias <= 7             ? 'fac-dias-warn'   :
                            'fac-dias-ok'

  const diasLabel =
    dias === null ? null :
    dias <= 0     ? 'Expirado' :
    dias === 1    ? '1 día restante' :
                    `${dias} días restantes`

  // La capacidad puede no venir (falló un conteo): entonces la tarjeta no se pinta,
  // pero la página —que es su factura— sí.
  const capacidad = data.capacidad
  const excedidas = capacidad?.filter(f => f.excedido) ?? []
  const cercanas  = capacidad?.filter(f => f.cerca)    ?? []

  const estadoCls =
    data.estado === 'ACTIVO'                              ? 'prf-badge-activo'   :
    data.estado === 'TRIAL'                               ? 'prf-badge-trial'    :
    data.estado === 'GRACIA'                              ? 'prf-badge-gracia'   :
    ['VENCIDO', 'DESACTIVADO'].includes(data.estado)       ? 'prf-badge-vencido'  : ''

  return (
    <div className="view-container">

      {/* ── Cabecera ── */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Suscripción</h1>
          <p className="page-subtitle">Estado de tu suscripción e historial de pagos.</p>
        </div>
      </div>

      {/* ── Alerta: período especial, o vence pronto / ya venció ── */}
      {/* Ser Socio CLAUX manda sobre lo demás: si no se le cobra, el aviso de gracia
          («venció, ponte al día») diría justo lo contrario de lo pactado. */}
      {data.es_socio ? (
        <div className="alert alert-success">
          <strong className="alert-titulo">Eres Socio CLAUX</strong>
          Tienes el portal completo y no se te genera ningún cobro
          {data.socio_hasta ? ` hasta el ${fmt(data.socio_hasta)}` : ''}.
        </div>
      ) : enGracia ? (
        <div className="alert alert-warning alert-cta">
          <span className="alert-cta-texto">
            Tu suscripción venció, pero tienes una prórroga activa hasta el {fmt(data.fecha_fin_gracia)}. Contáctanos para ponerte al día.
          </span>
          <a
            href={`mailto:${data.email_soporte}?subject=${encodeURIComponent(`Quiero renovar mi suscripción — ${data.client_id}`)}`}
            className="btn btn-aviso btn-sm"
          >
            Contactar
          </a>
        </div>
      ) : dias !== null && dias <= 7 && (
        <div className={`alert mb-5 ${dias <= 0 ? 'alert-error' : 'alert-warning'}`}>
          {dias <= 0
            ? 'Tu suscripción ha expirado. Contacta a soporte para renovarla.'
            : `Tu suscripción vence en ${dias} día${dias === 1 ? '' : 's'}. Contacta a soporte para renovarla.`}
        </div>
      )}

      {/* ── Suscripción activa ── */}
      <div className="card mb-5">
        <div className="fac-plan-card">
          <div className="fac-plan-left">
            <div className="fac-plan-title-row">
              <h2 className="fac-plan-name">{data.suscripcion}</h2>
              <span className={`prf-badge ${estadoCls}`}>{ESTADO_LABEL[data.estado] ?? data.estado}</span>
              {data.es_socio && <span className="prf-badge prf-badge-socio">Socio CLAUX</span>}
              {/* El nivel es lo que de verdad ha contratado; el importe de arriba solo
                  dice cuánto le cuesta. A un Socio le cuesta cero y aun así tiene nivel:
                  es gratis, no ilimitado. */}
              <span className="prf-badge prf-badge-nivel">Nivel {data.nivel_nombre}</span>
            </div>
            <p className="fac-plan-id">{data.client_id}</p>
          </div>

          <div className="fac-plan-right">
            <div className="fac-expiry-block">
              <span className="fac-expiry-label">Vigente hasta</span>
              <span className="fac-expiry-date">
                {data.es_socio && !data.socio_hasta ? 'Sin fecha límite' : fmt(fechaVigencia)}
              </span>
              {diasLabel && (
                <span className={`fac-dias ${diasCls}`}>{diasLabel}</span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── Lo que cabe en su nivel ──
          Antes esto solo se sabía chocando: el aviso «has llegado al máximo de tu
          nivel Empresa» era el primer y único sitio donde se le nombraba el nivel.
          Aquí lo tiene antes de chocar, y de paso ve por dónde va. Solo lectura:
          quien cambia límites es el equipo, desde la ficha del cliente.
          `card` a secas y no `card-table`: esa anula el padding con `!important`
          y aquí hay párrafo, aviso y pie que se quedarían pegados al borde. */}
      {capacidad && capacidad.length > 0 && (
        <div className="card mb-5">
          <div className="card-header">
            <h2 className="card-title card-title-sm">Lo que cabe en tu nivel</h2>
            <span className={`badge ${excedidas.length ? 'badge-error' : cercanas.length ? 'badge-warning' : 'badge-neutral'}`}>
              {excedidas.length
                ? `${excedidas.length} por encima`
                : cercanas.length
                  ? `${cercanas.length} al límite`
                  : 'Con sitio de sobra'}
            </span>
          </div>

          <p className="text-sm-muted mb-4">
            Esto es lo que te cabe con el nivel <strong>{data.nivel_nombre}</strong>.
          </p>

          {excedidas.length > 0 && (
            <div className="alert alert-warning">
              <strong className="alert-titulo">Vas por encima del tope en {excedidas.length}</strong>
              {excedidas.map(f => `${f.etiqueta} (${f.usado} de ${f.limite})`).join(' · ')}.
              No se te rompe nada: sigues trabajando con lo que ya tienes, pero no puedes añadir más de eso.
            </div>
          )}

          <div className="table-wrapper table-wrapper-flush">
            <table className="table">
              <thead>
                <tr>
                  <th>Concepto</th>
                  <th className="col-num">En uso</th>
                  <th className="col-num">Tope</th>
                  <th>Disponible</th>
                </tr>
              </thead>
              <tbody>
                {capacidad.map(f => (
                  <tr key={f.dimension}>
                    <td data-label="Concepto">
                      {f.etiqueta.charAt(0).toUpperCase() + f.etiqueta.slice(1)}
                    </td>
                    <td data-label="En uso" className="col-num">{f.usado.toLocaleString('es-ES')}</td>
                    <td data-label="Tope"   className="col-num">
                      {f.limite === null ? 'Sin tope' : f.limite.toLocaleString('es-ES')}
                    </td>
                    <td data-label="Disponible">
                      {f.limite === null
                        ? <span className="table-muted">Ilimitado</span>
                        : f.excedido
                          ? <span className="badge badge-error">Por encima</span>
                          : f.cerca
                            ? <span className="badge badge-warning">Te quedan {(f.limite - f.usado).toLocaleString('es-ES')}</span>
                            : <span className="table-muted">Te quedan {(f.limite - f.usado).toLocaleString('es-ES')}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Subir de nivel se pide DESDE AQUÍ, que es donde el dueño se entera de
              que se le está llenando algo. Hasta ahora la salida era «escríbenos»:
              un correo que hay que redactar es una puerta cerrada.

              El botón NO cambia el nivel. El cobro es manual, así que lo que hace es
              registrar la petición por el mismo circuito que cualquier contratación
              (`soporte_mensajes` → /admin/ventas/ampliaciones → campana del equipo) y
              el nivel lo sube el equipo al cobrar. Aplicarlo solo y cobrar después
              sería regalar capacidad a quien no pague y, peor, prometer un automatismo
              que no existe. Misma clave que el banner del dashboard: pedirlo en un
              sitio se ve en el otro, porque es la misma petición. */}
          {data.nivel_siguiente && (
            <div className="alert alert-info alert-cta mt-4">
              <span className="alert-cta-texto">
                <strong className="alert-titulo">¿Se te queda pequeño?</strong>
                El nivel {data.nivel_siguiente.nombre} te da más de todo, con lo que ya tienes
                dentro y sin parar de trabajar. Lo activamos nosotros.
                {pedido && pedido !== 'ahora' && (
                  <span className="alert-cta-nota">Lo pediste el {fmt(pedido)}.</span>
                )}
              </span>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={() => pedirNivel(data.nivel_siguiente!.nombre)}
                disabled={enviando || !!pedido}
              >
                {enviando
                  ? <><span className="spinner spinner-sm" /> Enviando…</>
                  : pedido
                    ? <><Check size={14} aria-hidden="true" /> Te contactamos</>
                    : <><TrendingUp size={14} aria-hidden="true" /> Quiero el nivel {data.nivel_siguiente.nombre} <ArrowRight size={14} aria-hidden="true" /></>}
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── Historial de pagos ── */}
      <div className="card card-table">
        <div className="mon-card-header">
          <h2 className="mon-section-title">Historial de pagos</h2>
          <div className="flex-center-2">
            <span className="text-xs-muted">
              {data.pagos.length} registro{data.pagos.length !== 1 ? 's' : ''}
            </span>
            {pendiente > 0 && (
              <span className="badge badge-warning">{fmtUsd(pendiente)} pendiente</span>
            )}
          </div>
        </div>

        {data.pagos.length === 0 ? (
          <div className="mon-empty">
            <Receipt size={36} strokeWidth={1} opacity={0.25} />
            <p>No hay pagos registrados aún.</p>
          </div>
        ) : (
          <div className="table-wrapper">
            <table className="table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Fecha</th>
                  <th>Período</th>
                  <th>Concepto</th>
                  <th>Estado</th>
                  <th className="col-num">Monto</th>
                  <th>Método</th>
                </tr>
              </thead>
              <tbody>
                {pageItems.map(p => (
                  <tr key={p.pago_id}>
                    <td data-label="ID">
                      <span className="fac-pago-id">{p.pago_id}</span>
                    </td>
                    <td data-label="Fecha" className="text-sm-nowrap">
                      {fmt(p.fecha)}
                    </td>
                    <td data-label="Período">
                      {p.fecha_inicio_periodo && p.fecha_fin_periodo ? (
                        <span className="fac-periodo">
                          {fmt(p.fecha_inicio_periodo)}
                          <span className="fac-periodo-sep">→</span>
                          {fmt(p.fecha_fin_periodo)}
                        </span>
                      ) : (
                        <span className="text-sm-muted">—</span>
                      )}
                    </td>
                    <td data-label="Concepto" className="text-sm-muted">
                      {p.concepto === 'configuracion' ? 'Configuración' : 'Suscripción'}
                    </td>
                    <td data-label="Estado">
                      <span className={`badge ${p.estado === 'por_confirmar' ? 'badge-warning' : 'badge-success'}`}>
                        {p.estado === 'por_confirmar' ? 'Pendiente' : 'Pagado'}
                      </span>
                    </td>
                    <td data-label="Monto" className="col-num">
                      <span className="fac-monto">{fmtUsd(p.monto_usd)}</span>
                    </td>
                    <td data-label="Método">
                      <span className="fac-metodo">{METODO_LABEL[p.metodo] ?? p.metodo}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <TablePagination {...pag} label="pago" />
      </div>

    </div>
  )
}

