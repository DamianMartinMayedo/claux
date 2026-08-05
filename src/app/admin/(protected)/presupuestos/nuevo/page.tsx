import { requireAccesoPagina } from '@/lib/admin-guard'
import { createAdminClient } from '@/lib/supabase/admin'
import { listarModulosParaPresupuesto, listarComerciales } from '@/app/actions/presupuestos'
import { LIMITE_FUNDADOR } from '@/lib/presupuesto/config'
import { cargarParametros } from '@/lib/presupuesto/parametros'
import { getSetting } from '@/app/actions/settings'
import PresupuestoCalculadora from './PresupuestoCalculadora'

export const dynamic = 'force-dynamic'

export default async function NuevoPresupuestoPage({
  searchParams,
}: {
  searchParams: Promise<{ lead?: string; cliente?: string; negocio?: string; responsable?: string; contacto?: string; modulos?: string; tarifa?: string }>
}) {
  const ctx = await requireAccesoPagina('presupuestos')
  const { lead, cliente, negocio, responsable, contacto: contactoQs, modulos: modulosQs, tarifa: tarifaQs } = await searchParams

  // Los precios se cargan AQUÍ y viajan enteros a la calculadora, que se los pasa al
  // cálculo. La misma tanda llega luego a la acción de guardar, para que la vista previa y
  // el recálculo autoritativo no puedan partir de números distintos.
  const [modulos, comerciales, parametros] = await Promise.all([
    listarModulosParaPresupuesto(),
    listarComerciales(),
    cargarParametros(),
  ])

  const db = createAdminClient()

  // Prefill desde un lead de diagnóstico o desde un CLIENTE QUE YA EXISTE (opcionales).
  let prefill = {
    diagnosticoId: null as number | null,
    clientId: null as string | null,
    nombreNegocio: '', nombreResponsable: '', contacto: '',
    modulos: [] as string[],
    tarifa: null as 'fundador' | 'estandar' | null,
  }

  // Presupuesto para un cliente en marcha: es el caso de la ampliación —contrata inventario
  // seis meses después y hay que configurarlo y migrar—, que hasta ahora no se podía cotizar
  // aunque la acción ya aceptara el `clientId`. Se precargan sus módulos actuales para que el
  // comercial marque solo lo que se añade.
  if (cliente) {
    // `clients` NO tiene columna de teléfono, y pedirla aquí no fallaba en voz alta:
    // PostgREST rechaza la consulta ENTERA por una columna inexistente, así que `data`
    // salía null, el `if` no entraba y **todo el prefill se perdía en silencio** — el
    // comercial reteclea negocio, responsable y contacto, la ampliación pierde sus
    // módulos actuales y, peor, se queda sin `clientId` (o sea, deja de ser una
    // ampliación) y sin su tarifa de fundador. El contacto de un cliente es su
    // `email_admin`, que además es NOT NULL. Ver CONTEXTO §2 › Fundaciones: un cliente
    // no es un lead del embudo, no hay teléfono que traer.
    const { data } = await db
      .from('clients')
      .select('client_id, nombre_empresa, nombre_contacto, email_admin, modulos_activos, tarifa')
      .eq('client_id', cliente)
      .maybeSingle()
    if (data) {
      prefill = {
        diagnosticoId:     null,
        clientId:          data.client_id,
        nombreNegocio:     data.nombre_empresa ?? '',
        // Se traen TODOS los datos que ya tenemos: volver a teclear el responsable y el
        // contacto de un cliente que lleva meses con nosotros es pedirle al comercial que
        // copie a mano lo que está en la ficha de al lado.
        nombreResponsable: data.nombre_contacto ?? '',
        contacto:          data.email_admin ?? '',
        modulos:           Array.isArray(data.modulos_activos)
          ? data.modulos_activos.filter((c: string) => modulos.some(m => m.clave === c))
          : [],
        // Y su tarifa comercial, que es la que decide el precio de los módulos: si el cliente
        // es fundador, su ampliación se cotiza como fundador.
        tarifa: data.tarifa === 'fundador' ? 'fundador' : 'estandar',
      }
    }
  }

  // Viene del alta manual de cliente: el cliente aún NO existe (se está creando), así que no
  // hay `client_id` que traer — viajan los datos ya tecleados para no volver a escribirlos.
  // Al aprobar este presupuesto se crea el cliente desde él y el enlace queda hecho.
  if (!cliente && (negocio || modulosQs)) {
    prefill = {
      diagnosticoId:     null,
      clientId:          null,
      nombreNegocio:     negocio ?? '',
      nombreResponsable: responsable ?? '',
      contacto:          contactoQs ?? '',
      modulos: (modulosQs ?? '').split(',').map(c => c.trim())
        .filter(c => c && modulos.some(m => m.clave === c)),
      tarifa: tarifaQs === 'fundador' ? 'fundador' : tarifaQs === 'estandar' ? 'estandar' : null,
    }
  }

  if (lead) {
    const id = parseInt(lead, 10)
    if (!Number.isNaN(id)) {
      const { data } = await db
        .from('diagnosticos')
        .select('id, nombre, telefono, email, modulos_rec')
        .eq('id', id)
        .maybeSingle()
      if (data) {
        const rec = (data.modulos_rec ?? []).filter((c: string) => modulos.some(m => m.clave === c))
        prefill = {
          diagnosticoId:     data.id,
          clientId:          null,
          nombreNegocio:     data.nombre ?? '',
          nombreResponsable: '',
          contacto:          data.telefono || data.email || '',
          modulos:           rec,
          tarifa:            null,
        }
      }
    }
  }

  // Sugerencia de tarifa: fundador si aún estamos dentro de los primeros N clientes.
  const { count } = await db.from('clients').select('*', { count: 'exact', head: true })
  // La del cliente manda cuando lo hay; si no, la sugerencia por antigüedad.
  // El ciclo anual es la palanca de venta del bloque recurrente, y su descuento es un ajuste
  // global: sin él, el comercial tenía que calcularlo a mano.
  const descuentoAnualPct = parseInt(await getSetting('descuento_anual_pct', '10'), 10) || 0

  const tarifaSugerida: 'fundador' | 'estandar' =
    prefill.tarifa ?? ((count ?? 0) < LIMITE_FUNDADOR ? 'fundador' : 'estandar')

  return (
    <PresupuestoCalculadora
      modulos={modulos}
      comerciales={comerciales}
      comercialEmailDefault={ctx.email}
      tarifaSugerida={tarifaSugerida}
      parametros={parametros}
      descuentoAnualPct={descuentoAnualPct}
      prefill={prefill}
    />
  )
}
