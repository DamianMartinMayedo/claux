// ── De la base de datos a una propuesta resuelta ────────────────────────────
//
// La mitad impura: aquí se consulta y se traduce, y el armado —que es donde
// están las reglas— se queda puro en `armar.ts`. Corre en el servidor con el
// cliente de servicio: la propuesta pública no tiene sesión, la autoriza el
// token.
//
// La misma función sirve al enlace real y a la vista previa del borrador, con lo
// único que las diferencia como argumento. Que sean la misma es el punto: el
// comercial previsualiza exactamente lo que va a ver el cliente.

import { createAdminClient } from '@/lib/supabase/admin'
import { COLUMNAS_PRECIO } from '@/lib/niveles'
import { obtenerCatalogoPublico } from '@/lib/publico/catalogo'
import { tamanoComoTexto } from '@/lib/publico/tamano'
import { etiquetaModo } from '@/lib/publico/modos'
import { esTokenValido } from '@/lib/publico/token'
import {
  AJUSTES_POR_DEFECTO, armarPropuesta, capturasDePropuesta, prefillPropuesta,
  type AjustesPropuesta, type EntradaArmado, type FilaPresupuesto, type FilaPropuesta,
  type LeadResumen, type ModuloCatalogo,
} from './armar'
import type { Captura, Prefill, PropuestaResuelta } from './tipos'
import {
  CLAVES_AJUSTES, CLAVES_AJUSTES_LISTA, lineasDesde, tarjetasDesde, textoDesde,
} from './ajustes'

/* eslint-disable @typescript-eslint/no-explicit-any */
type Db = any

const CAMPOS_PROPUESTA =
  'id, diagnostico_id, presupuesto_id, client_id, titulo, nombre_negocio, '
  + 'comercial_nombre, comercial_email, comercial_tel, nivel, moneda, modulos, '
  + 'estado, token, secciones_ocultas, secciones_orden, publicada_at, updated_at'

const CAMPOS_PRESUPUESTO =
  'modulos, desglose, horas_total, tarifa_hora, descuento_pct, '
  + 'coste_instalacion, total_final, cuota_mensual, moneda, updated_at'

/** Los ajustes editables. Fallan hacia los valores por defecto del código. */
async function cargarAjustes(db: Db): Promise<AjustesPropuesta> {
  const { data } = await db.from('settings').select('key, value')
    .in('key', ['dias_trial_default', 'descuento_anual_pct', ...CLAVES_AJUSTES_LISTA])
  const v = new Map<string, string>((data ?? []).map((r: { key: string; value: string }) => [r.key, r.value]))
  const numero = (k: string, def: number) => {
    const n = Number(v.get(k))
    return Number.isFinite(n) && n >= 0 ? n : def
  }
  const D = AJUSTES_POR_DEFECTO
  return {
    ...D,
    diasPrueba:        numero('dias_trial_default', D.diasPrueba),
    descuentoAnualPct: numero('descuento_anual_pct', D.descuentoAnualPct),
    // Los textos fijos: lo que haya en Configuración pisa al código, y lo que no
    // esté escrito se queda con el del código. Nunca se queda en blanco.
    queEsTarjetas:     tarjetasDesde(v.get(CLAVES_AJUSTES.queEs),     D.queEsTarjetas),
    problemaClaux:     lineasDesde(v.get(CLAVES_AJUSTES.problema),    D.problemaClaux),
    confianzaTarjetas: tarjetasDesde(v.get(CLAVES_AJUSTES.confianza), D.confianzaTarjetas),
    empecemosPasos:    tarjetasDesde(v.get(CLAVES_AJUSTES.empecemos), D.empecemosPasos),
    pago:              textoDesde(v.get(CLAVES_AJUSTES.pago),         D.pago),
  }
}

/**
 * El diagnóstico, traducido a lo que el visitante leyó. El lead no guarda texto:
 * `tamano` son índices de nivel y sector/necesidades son claves de sus tablas.
 * Sin el catálogo vivo, la diapositiva 2 diría «Sector: servicios».
 */
async function cargarLead(db: Db, diagnosticoId: number): Promise<LeadResumen | null> {
  const { data: lead } = await db.from('diagnosticos')
    .select('sector, necesidades, modo_actual, tamano')
    .eq('id', diagnosticoId).maybeSingle()
  if (!lead) return null

  const { sectores, niveles, necesidades } = await obtenerCatalogoPublico()
  const sector = sectores.find(s => s.sector === lead.sector)
  const lineas = tamanoComoTexto(niveles, sector?.modulos ?? [], lead.tamano)
  const personas = lineas.find(l => l.etiqueta === 'Personas en el equipo')
  const primera = (lead.necesidades as string[] | null)?.[0] ?? null

  return {
    sectorClave:   lead.sector ?? null,
    sectorNombre:  sector?.nombre ?? lead.sector ?? null,
    bandaPersonas: personas?.respuesta ?? null,
    modoActual:    lead.modo_actual ?? null,
    modoEtiqueta:  lead.modo_actual ? etiquetaModo(lead.modo_actual) : null,
    necesidadPrincipal: primera
      ? (necesidades.find(n => n.clave === primera)?.etiqueta ?? primera)
      : null,
  }
}

/**
 * Todo lo que cuelga de una propuesta ya localizada, reunido. Devuelve la
 * ENTRADA del motor y no el resultado porque hay dos consumidores: la
 * presentación quiere las diapositivas, y el editor quiere además los
 * prellenados. Las dos cosas salen de la misma entrada y de una sola consulta.
 */
async function entradaDesdeFila(db: Db, fila: Record<string, unknown>): Promise<EntradaArmado> {
  const p = fila as unknown as FilaPropuesta & {
    diagnostico_id: number | null
    presupuesto_id: number | null
    client_id:      string | null
  }

  const [textosRes, catRes, capRes, ajustes, lead, presupuesto] = await Promise.all([
    db.from('propuesta_textos').select('clave, cuerpo').eq('propuesta_id', p.id),
    db.from('modulos_catalogo')
      .select(`clave, nombre, descripcion, beneficio, resumen, activo, orden, ${COLUMNAS_PRECIO}`)
      .order('orden', { ascending: true }),
    db.from('capturas_producto').select('id, modulo, vista, url, alt, ancho, alto, sector')
      .eq('activa', true).order('orden', { ascending: true }),
    cargarAjustes(db),
    p.diagnostico_id ? cargarLead(db, p.diagnostico_id) : Promise.resolve(null),
    p.presupuesto_id
      ? db.from('presupuestos_instalacion').select(CAMPOS_PRESUPUESTO)
          .eq('id', p.presupuesto_id).maybeSingle().then((r: { data: FilaPresupuesto | null }) => r.data)
      : Promise.resolve(null),
  ])

  const textos: Record<string, string> = {}
  for (const t of (textosRes.data ?? []) as { clave: string; cuerpo: string | null }[]) {
    if (t.cuerpo) textos[t.clave] = t.cuerpo
  }

  // El sector para elegir entre las variantes de la biblioteca. Manda el del
  // CLIENTE cuando lo hay: es el dato que se comprobó al darlo de alta, mientras
  // que el del lead lo eligió el visitante de un desplegable. Una propuesta
  // suelta se queda sin sector y ve la captura común, que es lo correcto.
  const sector = p.client_id
    ? await db.from('clients').select('sector').eq('client_id', p.client_id).maybeSingle()
        .then((r: { data: { sector: string | null } | null }) => r.data?.sector ?? null)
    : lead?.sectorClave ?? null

  return {
    propuesta: p,
    textos,
    lead,
    presupuesto: presupuesto ?? null,
    catalogo: (catRes.data ?? []) as ModuloCatalogo[],
    capturas: (capRes.data ?? []) as Captura[],
    sector,
    ajustes,
  }
}

/** La propuesta armada a partir de una fila. */
async function armarDesdeFila(db: Db, fila: Record<string, unknown>): Promise<PropuestaResuelta> {
  return armarPropuesta(await entradaDesdeFila(db, fila))
}

/**
 * La propuesta del enlace público. Solo PUBLICADA: despublicar o revocar el
 * token deja el enlace en 404 al instante, que es lo que hace que revocarlo
 * signifique algo.
 */
export async function cargarPropuestaPublica(token: string): Promise<PropuestaResuelta | null> {
  const limpio = (token ?? '').trim()
  if (!esTokenValido(limpio)) return null   // forma del token: nada de escanear

  const db = createAdminClient()
  const { data } = await db.from('propuestas').select(CAMPOS_PROPUESTA)
    .eq('token', limpio).eq('estado', 'PUBLICADA').maybeSingle()
  if (!data) return null

  return armarDesdeFila(db, data as unknown as Record<string, unknown>)
}

/**
 * La propuesta en BORRADOR, para la vista previa del admin. Sin token y sin
 * exigir estado: quien llame tiene que haber pasado por el permiso —esta función
 * no es un server action y no se expone como endpoint—.
 */
export async function cargarPropuestaBorrador(id: number): Promise<PropuestaResuelta | null> {
  return (await cargarBorradorParaEditor(id))?.resuelta ?? null
}

/**
 * Lo mismo, más los prellenados: es lo que necesita el EDITOR para enseñar en
 * cada caja lo que va a decir el documento si se deja en blanco. Sale de la
 * misma consulta y del mismo motor que la presentación, y eso es el punto: lo
 * que se lee en la pantalla de edición no es una segunda versión del texto.
 */
export async function cargarBorradorParaEditor(id: number): Promise<{
  resuelta: PropuestaResuelta; prefill: Prefill; capturas: Captura[]
} | null> {
  const db = createAdminClient()
  const { data } = await db.from('propuestas').select(CAMPOS_PROPUESTA)
    .eq('id', id).maybeSingle()
  if (!data) return null

  const entrada = await entradaDesdeFila(db, data as unknown as Record<string, unknown>)
  return {
    resuelta: armarPropuesta(entrada),
    prefill:  prefillPropuesta(entrada),
    capturas: capturasDePropuesta(entrada),
  }
}
