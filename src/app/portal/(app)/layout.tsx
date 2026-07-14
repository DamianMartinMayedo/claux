import { redirect }       from 'next/navigation'
import { getPortalSession, debeCambiarPassword } from '@/app/actions/portal/auth'
import { obtenerEmpresasSelector } from '@/app/actions/portal/empresas'
import { obtenerEtiquetasNegocio } from '@/app/actions/portal/sector'
import { createAdminClient } from '@/lib/supabase/admin'
import { modulosDeUsuario, calcularAcceso } from '@/lib/permisos'
import PortalHeader          from '@/components/portal/PortalHeader'
import PortalSidebar, { type CatalogoItem } from '@/components/portal/PortalSidebar'
import BloqueadoScreen       from '@/components/portal/BloqueadoScreen'
import PortalRealtimeSync    from '@/components/portal/PortalRealtimeSync'
import TopLoader             from '@/components/portal/TopLoader'
import PortalToastWrapper     from '@/components/portal/PortalToastWrapper'
import { EmpresaColorProvider } from '@/components/portal/EmpresaColorContext'
import IaChatWidget          from '@/components/portal/ia/IaChatWidget'
import { IaProvider }        from '@/components/portal/ia/IaContext'
import ImpersonacionBanner   from '@/components/portal/ImpersonacionBanner'
import { configAgente }      from '@/lib/ia/contexto'

export default async function PortalAppLayout({ children }: { children: React.ReactNode }) {
  const session = await getPortalSession()
  if (!session) redirect('/portal/login')

  const db = createAdminClient()

  const [{ data: cliente }, { data: catalogo }, empresas, etiquetas, filasUsuario, debeCambiar] = await Promise.all([
    db
      .from('clients')
      .select('nombre_empresa, estado, modulos_activos, tarifa, precio_mensual_usd, ciclo_facturacion, fecha_expiracion, fecha_fin_gracia')
      .eq('client_id', session.client_id)
      .single(),
    db
      .from('modulos_catalogo')
      .select('clave, nombre, tipo, paginas, orden')
      .eq('activo', true)
      .order('orden'),
    obtenerEmpresasSelector(),
    obtenerEtiquetasNegocio(),
    modulosDeUsuario(db, session.user_id),
    debeCambiarPassword(session),
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
  const { visibles: modulosVisibles } = calcularAcceso(session, modulosActivos, filasUsuario)

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

  // Bloqueo basado en estado Y en fecha, sin depender de expiración automática:
  // · DESACTIVADO → siempre bloqueado (nunca han pagado o el admin los desactivó)
  // · VENCIDO    → siempre bloqueado (estado legado; ya no se genera automáticamente)
  // · Fecha expirada → bloqueado, salvo que estén en GRACIA con fecha_fin_gracia vigente
  const hoy = new Date().toISOString().split('T')[0]
  const enGraciaActiva =
    cliente.estado === 'GRACIA' &&
    !!cliente.fecha_fin_gracia &&
    cliente.fecha_fin_gracia.split('T')[0] >= hoy
  const expiradoPorFecha =
    !!cliente.fecha_expiracion &&
    cliente.fecha_expiracion.split('T')[0] < hoy
  const bloqueado =
    cliente.estado === 'DESACTIVADO' ||
    cliente.estado === 'VENCIDO' ||
    (expiradoPorFecha && !enGraciaActiva)

  return (
    <div className="portal-shell">
      <TopLoader />
      <PortalRealtimeSync clientId={session.client_id} />
      <PortalHeader
        session={session}
        nombreEmpresa={cliente.nombre_empresa}
        empresas={empresas}
      />
      <PortalSidebar
        modulosVisibles={modulosVisibles}
        catalogo={(catalogo ?? []) as CatalogoItem[]}
        catalogoEtiqueta={etiquetas.catalogo}
        catalogoIcono={etiquetas.catalogoIcono}
      />
      <main className="portal-main">
        {session.imp && <ImpersonacionBanner adminEmail={session.imp.admin_email} />}
        <PortalToastWrapper>
        {bloqueado
          ? <BloqueadoScreen estado={cliente.estado} />
          : <EmpresaColorProvider empresas={empresas}>
              <IaProvider value={{ tieneIa, nombreAgente }}>{children}</IaProvider>
            </EmpresaColorProvider>}
        </PortalToastWrapper>
        {!bloqueado && tieneIa && <IaChatWidget nombreAgente={nombreAgente} sugerencias={sugerenciasIa.slice(0, 4)} />}
      </main>
    </div>
  )
}
