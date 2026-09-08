// ── Puesta en marcha del negocio ──────────────────────────────────────────────
//
// Lo que le falta a este cliente para que la app deje de estar muda. Lo consume el
// bloque del dashboard (`Onboarding.tsx`), que es lo primero que ve un cliente
// nuevo.
//
// **Son tres pasos y una pregunta, y ese recorte es la decisión de diseño.** Hubo
// una versión con un paso por módulo contratado —crea un almacén, crea un punto de
// venta, pon el horario…— y con todo contratado salían DIECISIETE. Eso no es una
// guía de puesta en marcha: es una lista de deberes, y lo primero que se hace con
// una lista de deberes es cerrarla. Además sobraba: quien entra en Almacenes ya ve
// que no tiene ninguno, y quien importa sus datos se los encuentra llenos. Aquí
// solo va lo que **bloquea el negocio entero** mientras no esté:
//
//   moneda → empresa → letra de facturación
//
// más la pregunta del importador, que no configura nada pero tiene que llegar
// ANTES de que el dueño empiece a teclear a mano lo que ya tiene en otro sistema.
//
// El orden ES la dependencia real, y ahí había un fallo que este módulo arregla: el
// dashboard pedía la empresa primero, pero `empresas.moneda_funcional` es NOT NULL
// y la pantalla de empresas exige una moneda antes.
//
// **Se cuenta en vivo, no se sella.** Cada paso está «hecho» cuando existe la fila
// que lo prueba, así que crear la moneda desde su propia página lo marca sin
// cablear nada, y borrar la única moneda lo devuelve a pendiente. Es una foto del
// negocio, no un registro de lo que alguien pulsó un día — una tabla de progreso
// paralela solo podría acabar contradiciendo a los datos.
//
// **Cuando no queda nada, no hay bloque**: `calcularOnboarding` devuelve `null` y
// el dashboard es el dashboard. La guía se acaba, no se queda de adorno.

import { accesoImportCliente } from '@/lib/importador/acceso-cliente'
import type { PortalSession } from '@/lib/portal-auth'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any

/**
 * - `arranque` — falta moneda, empresa o letra. El bloque ocupa el sitio de los
 *   widgets: sin esto la app no hace nada, y unos widgets vacíos no lo explican.
 * - `afinar`   — lo básico está y solo queda la pregunta del importador. Tarjeta
 *   compacta arriba y los widgets vuelven: una pregunta no tapa un dashboard.
 */
export type OnbEstado = 'arranque' | 'afinar'

export interface OnbPaso {
  clave:   string
  titulo:  string
  /** Una línea de POR QUÉ hace falta. Solo si dice algo que el título no dice. */
  apoyo?:  string
  hecho:   boolean
  /** Página donde se resuelve del todo (y destino cuando no hay modal). */
  href:    string
  /** Modal que se abre sin salir del dashboard. */
  form?:   FormPaso
  /** Este usuario no puede ejecutarlo: se pinta sin botón y con `nota`. */
  ajeno?:  boolean
  nota?:   string
}

/**
 * Pasos que se resuelven SIN salir del dashboard. No con un formulario reducido: se
 * abre el MISMO modal de su página —color, logo, moneda funcional—, porque un paso
 * que deja la ficha a medias no es un paso hecho, y volver luego a completarla es
 * la navegación que la guía existe para ahorrar.
 *
 * `letra` reutiliza el modal de EMPRESA en edición: la letra vive dentro de él.
 */
export type FormPaso = 'moneda' | 'empresa' | 'letra'

export interface OnboardingData {
  estado: OnbEstado
  pasos:  OnbPaso[]
  hechos: number
  total:  number
  /**
   * Se pinta «Ocultar». La acción solo la acepta `admin_empresa` (un `usuario`
   * vería un botón que siempre falla), e impersonando NO se ofrece: el bloque se
   * enseña ignorando el ocultado, así que el equipo pulsaría, no vería ningún
   * cambio, y el cliente se quedaría sin su guía sin que nadie se enterara.
   */
  puedeOcultar: boolean
  /**
   * Se pinta «Empiezo de cero». Impersonando SÍ se ofrece, al revés que «Ocultar»,
   * y la diferencia es que su efecto se VE: el paso del importador desaparece
   * también para el equipo, así que es revisable y no un botón que no hace nada.
   */
  puedeDescartarImport: boolean
}

export interface CtxOnboarding {
  cid:      string
  session:  PortalSession
  /** Módulos CONTRATADOS por el tenant (no los visibles para este usuario). */
  modulos:  string[]
  ocultoAt: string | null
  importNo: boolean
}

const PEDIR_AL_ADMIN = 'Lo configura el administrador de la cuenta.'

/**
 * ¿Hay que calcular siquiera? Se responde ANTES de tocar la base para que el
 * bloque no le cueste una consulta a quien no lo va a ver.
 *
 * - **solo lectura** no crea nada (su única excepción de escritura son las tasas).
 * - **oculto** manda… salvo impersonando, que es la vía rápida de revisión del
 *   equipo y tiene que ver el bloque igual.
 */
export function onboardingVisible(
  session: Pick<PortalSession, 'solo_lectura' | 'imp'>,
  ocultoAt: string | null,
): boolean {
  if (session.solo_lectura) return false
  if (ocultoAt && !session.imp) return false
  return true
}

/** `null` = no queda nada que pedir, así que no hay bloque que pintar. */
export async function calcularOnboarding(db: Db, ctx: CtxOnboarding): Promise<OnboardingData | null> {
  const { cid, session, modulos } = ctx
  const esAdmin = session.rol === 'admin_empresa'

  const [empresasRows, monedasCount, acc] = await Promise.all([
    // Empresas del CLIENTE, no las asignadas a este usuario: el progreso es del
    // negocio. A un usuario sin empresas asignadas el bloque le diría «crea tu
    // empresa» sobre una que ya existe.
    db.from('empresas').select('letra_facturacion').eq('client_id', cid),
    // La moneda hace falta SIEMPRE, aunque el módulo no maneje importes: sin ella
    // no se puede crear la empresa, y sin empresa no hay nada.
    db.from('monedas').select('*', { count: 'exact', head: true }).eq('client_id', cid).eq('activa', true),
    // Misma regla ÚNICA que el menú de cuenta y el guard de /portal/importar-datos.
    accesoImportCliente(session),
  ])

  const empresas = (empresasRows?.data ?? []) as { letra_facturacion?: string | null }[]
  const monedas  = monedasCount?.count ?? 0

  // Los tres los crea el administrador de la cuenta y nadie más (`guardarMoneda` y
  // `guardarEmpresa` exigen `rol === 'admin_empresa'`). A quien no lo sea se le
  // enseñan igual —explican por qué la app está muda— pero sin botón y diciendo a
  // quién pedírselo.
  const basico = (p: Omit<OnbPaso, 'ajeno' | 'nota'>): OnbPaso =>
    esAdmin ? p : { ...p, ajeno: true, nota: PEDIR_AL_ADMIN }

  const pasos: OnbPaso[] = [
    basico({
      clave: 'moneda', titulo: 'Configurar la moneda',
      apoyo: 'Es la que llevan los precios, cobros y pagos.',
      hecho: monedas > 0, href: '/portal/monedas', form: 'moneda',
    }),
    basico({
      clave: 'empresa', titulo: 'Crear la empresa',
      apoyo: 'La que emite los documentos y agrupa los datos.',
      hecho: empresas.length > 0, href: '/portal/empresas', form: 'empresa',
    }),
  ]
  if (modulos.includes('base')) {
    pasos.push(basico({
      clave: 'letra', titulo: 'Asignar la letra de facturación',
      apoyo: 'La llevan todas las facturas: A-000001.',
      hecho: empresas.some(e => !!e.letra_facturacion), href: '/portal/empresas', form: 'letra',
    }))
  }

  const faltaBasico = pasos.some(p => !p.hecho)

  // El importador va DESPUÉS de lo básico (no se puede importar sin empresa ni
  // moneda) y ANTES de teclear un solo dato a mano. Se retira cuando el dueño
  // responde «empiezo de cero» o cuando la migración deja de estar pendiente.
  // Apunta SIEMPRE al importador del cliente, también impersonando: es la pantalla
  // que este paso anuncia, y el equipo revisa el portal entrando como el cliente.
  const preguntarImport = acc.disponible && acc.migracion_estado === 'pendiente' && !ctx.importNo
  if (preguntarImport) {
    pasos.push({
      clave: 'importar', titulo: '¿Hay datos de un sistema anterior?',
      apoyo: 'Productos, terceros y saldos, sin teclearlos uno a uno.',
      hecho: false,
      href: '/portal/importar-datos',
    })
  }

  // Nada pendiente ⇒ no hay bloque. La guía se acaba: no se queda una línea de
  // adorno felicitando a quien ya está trabajando.
  if (!faltaBasico && !preguntarImport) return null

  return {
    estado: faltaBasico ? 'arranque' : 'afinar',
    pasos,
    hechos: pasos.filter(p => p.hecho).length,
    total:  pasos.length,
    puedeOcultar:         !session.imp && esAdmin,
    puedeDescartarImport: esAdmin,
  }
}
