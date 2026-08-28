import { redirect }       from 'next/navigation'
import { FlaskConical }   from 'lucide-react'
import { getPortalSession, debeCambiarPassword } from '@/app/actions/portal/auth'
import { obtenerEmpresasSelector } from '@/app/actions/portal/empresas'
import { obtenerEtiquetasNegocio } from '@/app/actions/portal/sector'
import { createAdminClient } from '@/lib/supabase/admin'
import { modulosDeUsuario, calcularAcceso, type Permiso } from '@/lib/permisos'
import { accesoImportCliente } from '@/lib/importador/acceso-cliente'
import PortalHeader          from '@/components/portal/PortalHeader'
import PortalSidebar, { type CatalogoItem } from '@/components/portal/PortalSidebar'
import BloqueadoScreen       from '@/components/portal/BloqueadoScreen'
import PortalSync            from '@/components/portal/PortalSync'
import TopLoader             from '@/components/portal/TopLoader'
import PortalToastWrapper     from '@/components/portal/PortalToastWrapper'
import { EmpresaColorProvider } from '@/components/portal/EmpresaColorContext'
import IaChatWidget          from '@/components/portal/ia/IaChatWidget'
import { IaProvider }        from '@/components/portal/ia/IaContext'
import ImpersonacionBanner   from '@/components/portal/ImpersonacionBanner'
import { ConfiguradorProvider } from '@/components/portal/ConfiguradorContext'
import { NotificacionesProvider } from '@/components/portal/notificaciones/NotificacionesContext'
import NotificacionesPopups  from '@/components/portal/notificaciones/NotificacionesPopups'
import { contarNoLeidas, listarNotificaciones, popupsPendientes } from '@/app/actions/portal/notificaciones'
import { categoriasBandeja } from '@/lib/notificaciones/catalogo'
import { configAgente }      from '@/lib/ia/contexto'
// «Hoy» en la zona del NEGOCIO (America/Havana), no en UTC: con `toISOString()` a partir de
// las 20:00 la fecha ya es la de mañana, así que un documento registrado de noche el último
// día del mes caía en el mes siguiente. Una sola fuente: `lib/fecha-tz.ts`.
import { hoyEnTz } from '@/lib/fecha-tz'
import { accesoBloqueado, COLUMNAS_ACCESO } from '@/lib/clientes/ciclo-vida'

export default async function PortalAppLayout({ children }: { children: React.ReactNode }) {
  const session = await getPortalSession()
  if (!session) redirect('/portal/login')

  const db = createAdminClient()

  const [{ data: cliente }, { data: usr }, { data: catalogo }, empresas, etiquetas, filasUsuario, debeCambiar, accesoImport] = await Promise.all([
    db
      .from('clients')
      .select(`nombre_empresa, modulos_activos, precio_mensual_usd, ciclo_facturacion, ${COLUMNAS_ACCESO}`)
      .eq('client_id', session.client_id)
      .single(),
    db.from('client_users').select('permiso_defecto').eq('user_id', session.user_id).maybeSingle(),
    db
      .from('modulos_catalogo')
      .select('clave, nombre, tipo, paginas, orden')
      .eq('activo', true)
      .order('orden'),
    obtenerEmpresasSelector(),
    obtenerEtiquetasNegocio(),
    modulosDeUsuario(db, session.user_id),
    // La sesión de configuración (imp) se salta el cambio obligatorio: esa
    // contraseña es del cliente y la define él en su primer acceso. Forzarla aquí
    // bloquearía justo la tarea que viene a hacer el configurador.
    session.imp ? Promise.resolve(false) : debeCambiarPassword(session),
    // Importador de autoservicio: regla única de visibilidad (misma que el guard de
    // /portal/importar-datos), para pintar (o no) su entrada en el menú de cuenta.
    accesoImportCliente(session),
  ])

  if (!cliente) redirect('/portal/login')

  // Primer acceso / tras reset: obligar a definir una contraseña propia antes de
  // usar el portal. La página vive en (auth), fuera de este shell → sin bucle.
  if (debeCambiar) redirect('/portal/cambiar-password')

  // Módulos activos leídos del cliente (modelo à la carte). La contabilidad
  // 'base' es un módulo más: si el cliente no la contrató, no aparece activa.
  const modulosActivos: string[] = Array.isArray(cliente.modulos_activos)
    ? (cliente.modulos_activos as string[])
    : []

  // Módulos que ESTE usuario puede ver (tenant ∩ permisos por usuario). El sidebar
  // y los guards de página usan este subconjunto; las cascadas entre módulos NO.
  const rawDefecto = usr?.permiso_defecto
  const defecto: Permiso = rawDefecto === 'sin_acceso' || rawDefecto === 'ver' || rawDefecto === 'editar' ? rawDefecto : 'editar'
  const { visibles: modulosVisibles } = calcularAcceso(session, modulosActivos, defecto, filasUsuario)

  // Addon de IA: el chat flotante solo aparece si está contratado Y el usuario
  // tiene permiso para verlo. El nombre del agente es global; por defecto "Claux".
  const iaVisible = modulosVisibles.includes('asistente_ia')
  const tieneIa = iaVisible
  const nombreAgente = tieneIa ? (await configAgente()).nombreAgente : 'Claux'

  // Sugerencias iniciales del chat, relevantes a los módulos contratados (máx. 4).
  const sugerenciasIa: string[] = []
  if (tieneIa) {
    sugerenciasIa.push('¿Cómo va mi negocio?')
    if (modulosActivos.includes('base')) sugerenciasIa.push('¿Cómo van mis ventas?', '¿En qué estoy gastando más?')
    if (modulosActivos.includes('inventario')) sugerenciasIa.push('¿Qué me conviene reponer?')
    if (modulosActivos.includes('reservas_citas') || modulosActivos.includes('agenda')) sugerenciasIa.push('¿Cuántas reservas tengo hoy?')
  }

  // Quién entra y por qué se le cierra: una sola regla, en `lib/clientes/ciclo-vida`,
  // la misma que decide a quién se le puede escribir DESACTIVADO. Estuvo aquí
  // suelta y acabó discrepando del barrido —el barrido escribía, el guardia leía,
  // y ganaba el que escribía—; así fue como un Socio CLAUX vigente se encontró la
  // pantalla de «Cuenta suspendida» (DEUS, 2026-08-28).
  const hoy = hoyEnTz()
  const { bloqueado, motivo: motivoBloqueo } = accesoBloqueado(cliente, hoy)

  // Notificaciones internas: el admin ve la bandeja entera; un `usuario` ve solo
  // lo operativo de sus módulos (mapa fijo, decisión 4), y solo si le toca alguna
  // categoría. Solo con el portal operativo — bloqueado, la pantalla de bloqueo es
  // el único mensaje que toca dar.
  // Entrada «Importar datos» del menú de cuenta: solo con el portal operativo y si el
  // importador de autoservicio está disponible (permiso + módulo + no a cargo del equipo).
  const puedeImportarDatos = !bloqueado && accesoImport.disponible

  const catsBandeja = categoriasBandeja(session.rol, modulosVisibles)  // null = admin (todas)
  const verNotificaciones = !bloqueado && (catsBandeja === null || catsBandeja.length > 0)
  const notifInicial = verNotificaciones
    ? await cargaInicialNotificaciones()
    : { noLeidas: 0, recientes: [], popups: [] }

  const shell = (
    <>
      <TopLoader />
      <PortalSync />
      <PortalHeader
        session={session}
        nombreEmpresa={cliente.nombre_empresa}
        empresas={empresas}
        /* La MISMA bandera que monta el proveedor, aquí abajo. La campana la calculaba por
           su cuenta y se olvidaba de `bloqueado`. */
        verNotificaciones={verNotificaciones}
        puedeImportarDatos={puedeImportarDatos}
      />
      <PortalSidebar
        modulosVisibles={modulosVisibles}
        catalogo={(catalogo ?? []) as CatalogoItem[]}
        catalogoEtiqueta={etiquetas.catalogo}
        suscripcionEtiqueta={etiquetas.suscripcion}
        catalogoIcono={etiquetas.catalogoIcono}
      />
      <main className="portal-main">
        {session.imp && <ImpersonacionBanner adminEmail={session.imp.admin_email} />}
        {cliente.es_prueba && (
          <div className="imp-banner" role="status">
            <FlaskConical className="imp-banner-icon" size={18} />
            <p className="imp-banner-text"><strong>Entorno de prueba</strong></p>
          </div>
        )}
        <PortalToastWrapper>
        {bloqueado
          ? <BloqueadoScreen motivo={motivoBloqueo} />
          : <EmpresaColorProvider empresas={empresas}>
              <ConfiguradorProvider value={!!session.imp}>
                <IaProvider value={{ tieneIa, nombreAgente }}>{children}</IaProvider>
              </ConfiguradorProvider>
            </EmpresaColorProvider>}
        </PortalToastWrapper>
        {!bloqueado && tieneIa && <IaChatWidget nombreAgente={nombreAgente} sugerencias={sugerenciasIa.slice(0, 4)} />}
        {verNotificaciones && <NotificacionesPopups />}
      </main>
    </>
  )

  return (
    <div className="portal-shell">
      {verNotificaciones
        ? <NotificacionesProvider inicial={notifInicial}>{shell}</NotificacionesProvider>
        : shell}
    </div>
  )
}

// Carga inicial de la campana: evita que el contador parpadee de 0 al valor real
// en cuanto monta el cliente.
async function cargaInicialNotificaciones() {
  const [noLeidas, recientes, popups] = await Promise.all([
    contarNoLeidas(),
    listarNotificaciones('todas', 8),
    popupsPendientes(),
  ])
  return { noLeidas, recientes, popups }
}
