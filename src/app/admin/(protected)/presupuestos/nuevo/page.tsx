import { requireAccesoPagina } from '@/lib/admin-guard'
import { createAdminClient } from '@/lib/supabase/admin'
import { listarModulosParaPresupuesto, listarComerciales } from '@/app/actions/presupuestos'
import { cargarParametros } from '@/lib/presupuesto/parametros'
import { normalizarNivel, type Nivel } from '@/lib/niveles'
import { normalizarMonedaClaux, type MonedaClaux } from '@/lib/moneda-claux'
import { nombresDeNiveles, limitesDeNiveles } from '@/lib/niveles-server'
import { getSetting } from '@/app/actions/settings'
import PresupuestoCalculadora from './PresupuestoCalculadora'

export const dynamic = 'force-dynamic'

export default async function NuevoPresupuestoPage({
  searchParams,
}: {
  searchParams: Promise<{ lead?: string; cliente?: string; negocio?: string; responsable?: string; contacto?: string; modulos?: string; nivel?: string; moneda?: string }>
}) {
  const ctx = await requireAccesoPagina('presupuestos')
  const { lead, cliente, negocio, responsable, contacto: contactoQs, modulos: modulosQs, nivel: nivelQs, moneda: monedaQs } = await searchParams

  // Los precios se cargan AQUÍ y viajan enteros a la calculadora, que se los pasa al
  // cálculo. La misma tanda llega luego a la acción de guardar, para que la vista previa y
  // el recálculo autoritativo no puedan partir de números distintos.
  const [modulos, comerciales, parametros, nombresNivel, limitesNivel] = await Promise.all([
    listarModulosParaPresupuesto(),
    listarComerciales(),
    cargarParametros(),
    nombresDeNiveles(),
    limitesDeNiveles(),
  ])

  const db = createAdminClient()

  // `?modulos=` MANDA sobre lo que se deduce del origen (el lead o el cliente).
  // Es la vía por la que llega lo que se marcó en el configurador de una
  // propuesta: sin esto, el origen pisaba lo acordado en la reunión con lo que
  // sugirió un formulario hace semanas o con los módulos que el cliente ya tenía.
  // Se filtra contra el catálogo vivo — una clave retirada no puede entrar.
  const modulosPedidos = (modulosQs ?? '').split(',').map(c => c.trim())
    .filter(c => c && modulos.some(m => m.clave === c))

  // Prefill desde un lead de diagnóstico o desde un CLIENTE QUE YA EXISTE (opcionales).
  let prefill = {
    diagnosticoId: null as number | null,
    clientId: null as string | null,
    nombreNegocio: '', nombreResponsable: '', contacto: '',
    modulos: [] as string[],
    nivel: null as Nivel | null,
    moneda: null as MonedaClaux | null,
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
      .select('client_id, nombre_empresa, nombre_contacto, email_admin, modulos_activos, nivel, moneda_facturacion')
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
        modulos: modulosPedidos.length > 0
          ? modulosPedidos
          : Array.isArray(data.modulos_activos)
            ? data.modulos_activos.filter((c: string) => modulos.some(m => m.clave === c))
            : [],
        // Y su nivel, que es el que decide el precio de los módulos: la ampliación de un
        // cliente Inicial se cotiza a precio Inicial.
        nivel: normalizarNivel(data.nivel),
        // Y su moneda: a un cliente al que se le factura en euros no se le cotiza la
        // ampliación en dólares.
        moneda: normalizarMonedaClaux(data.moneda_facturacion),
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
      modulos:           modulosPedidos,
      nivel: nivelQs ? normalizarNivel(nivelQs) : null,
      moneda: monedaQs ? normalizarMonedaClaux(monedaQs) : null,
    }
  }

  if (lead) {
    const id = parseInt(lead, 10)
    if (!Number.isNaN(id)) {
      const { data } = await db
        .from('diagnosticos')
        .select('id, nombre, telefono, email, modulos_rec, nivel_rec')
        .eq('id', id)
        .maybeSingle()
      if (data) {
        const rec = modulosPedidos.length > 0
          ? modulosPedidos
          : (data.modulos_rec ?? []).filter((c: string) => modulos.some(m => m.clave === c))
        prefill = {
          diagnosticoId:     data.id,
          clientId:          null,
          nombreNegocio:     data.nombre ?? '',
          nombreResponsable: '',
          contacto:          data.telefono || data.email || '',
          modulos:           rec,
          // El nivel que salió del diagnóstico (mig. 219). El comercial puede
          // cambiarlo, pero arrancar en el que declaró el propio cliente evita
          // cotizarle un nivel donde ya sabemos que no cabe.
          nivel:             nivelQs ? normalizarNivel(nivelQs)
                             : data.nivel_rec ? normalizarNivel(data.nivel_rec) : null,
          // Un lead no tiene moneda: la elige el comercial al cotizar, salvo que
          // venga en la URL desde una propuesta que ya la tiene decidida.
          moneda:            monedaQs ? normalizarMonedaClaux(monedaQs) : null,
        }
      }
    }
  }

  // El ciclo anual es la palanca de venta del bloque recurrente, y su descuento es un ajuste
  // global: sin él, el comercial tenía que calcularlo a mano.
  const descuentoAnualPct = parseInt(await getSetting('descuento_anual_pct', '10'), 10) || 0

  // El nivel del cliente manda cuando lo hay. Si no, se arranca en el de entrada: el que
  // corresponde lo decide lo que el negocio necesita (cuántas empresas, cuánta plantilla,
  // cuánto catálogo), y eso se ve marcando volúmenes, no al abrir la página.
  const nivelSugerido: Nivel = prefill.nivel ?? 'inicial'

  return (
    <PresupuestoCalculadora
      modulos={modulos}
      comerciales={comerciales}
      comercialEmailDefault={ctx.email}
      nivelSugerido={nivelSugerido}
      nombresNivel={nombresNivel}
      limitesNivel={limitesNivel}
      parametros={parametros}
      descuentoAnualPct={descuentoAnualPct}
      prefill={prefill}
    />
  )
}
