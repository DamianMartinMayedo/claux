// ── Mapa del portal que ve ESTE usuario ──
// El agente conocía los NÚMEROS del negocio y no sabía dónde está nada: a «¿cómo
// añado una moneda?» respondió que revisara «el módulo de Ajustes» —que no existe— o
// «la sección de Contabilidad» —donde las monedas no están—. No era culpa del prompt:
// nunca se le dio el mapa, y el prompt, al pedirle que «sugiera qué módulo lo
// aportaría» cuando falta un dato, lo empujaba justo a rellenar el hueco.
//
// El mapa se arma con lo MISMO que dibuja la navegación (`construirNavegacion` para el
// menú lateral, `PAGINAS_CUENTA` para el de la cuenta) y con las mismas reglas de
// visibilidad. Consecuencia buscada: renombrar una página desde /admin cambia a la vez
// el menú y lo que dice el agente, sin tocar código ni acordarse de esta lista.
//
// Va SOLO al chat libre, que es donde se pregunta «dónde está X». Los insights de
// sección analizan cifras dentro de su propia pantalla y no lo pagan.

import { createAdminClient } from '@/lib/supabase/admin'
import { construirNavegacion, type ModuloNav } from '@/lib/portal/navegacion'
import { paginasCuentaVisibles, GRUPOS_CUENTA } from '@/lib/portal/paginas-cuenta'
import type { EtiquetasSector } from '@/lib/sector'

/** Lo que decide qué entradas del menú de la cuenta ve este usuario. */
export interface AccesoCuenta {
  esAdmin: boolean
  /** Permiso de importar ∩ autoservicio encendido ∩ migración no a cargo del equipo. */
  puedeImportar: boolean
}

export interface GrupoMapa {
  /** El menú lateral de siempre, o el de la cuenta (el avatar, arriba a la derecha). */
  sitio:   'lateral' | 'cuenta'
  /** Grupo desplegable al que pertenece; null = suelta, sin grupo. */
  grupo:   string | null
  paginas: string[]
}

export async function construirMapaPortal(
  modulosVisibles: string[],
  etiquetas: Pick<EtiquetasSector, 'catalogo' | 'suscripcion'>,
  cuenta: AccesoCuenta,
): Promise<GrupoMapa[]> {
  const db = createAdminClient()
  const { data } = await db
    .from('modulos_catalogo')
    .select('clave, nombre, tipo, paginas, orden')
    .eq('activo', true)
    .order('orden')

  const nav = construirNavegacion({
    catalogo: (data ?? []) as ModuloNav[],
    modulosVisibles,
    etiquetas,
  })

  const mapa: GrupoMapa[] = [
    { sitio: 'lateral', grupo: null, paginas: nav.sueltas.map(p => p.label) },
    ...nav.grupos.map(g => ({ sitio: 'lateral' as const, grupo: g.nombre, paginas: g.paginas.map(p => p.label) })),
  ]

  const cuentaVisible = paginasCuentaVisibles(cuenta)
  for (const grupo of GRUPOS_CUENTA) {
    const paginas = cuentaVisible.filter(p => p.grupo === grupo).map(p => p.label)
    if (paginas.length) mapa.push({ sitio: 'cuenta', grupo, paginas })
  }

  return mapa.filter(g => g.paginas.length > 0)
}

// Sin rutas a propósito: al dueño no le sirve `/portal/monedas`, le sirve saber por
// qué menú entrar. Ponerlas solo invitaría al modelo a escupirlas.
const SITIO: Record<GrupoMapa['sitio'], string> = {
  lateral: 'Menú lateral (izquierda)',
  cuenta:  'Menú de la cuenta (el avatar, arriba a la derecha)',
}

export function mapaComoTexto(mapa: GrupoMapa[]): string {
  return mapa
    .map(g => `${SITIO[g.sitio]}${g.grupo ? ` › ${g.grupo}` : ' › (suelto, sin grupo)'}: ${g.paginas.join(', ')}`)
    .join('\n')
}

// Reglas de uso del mapa. Van AQUÍ y no en el documento de personalidad
// (`ia_instrucciones`) a propósito: ese documento es editable desde /admin y, el día
// que se guarde una versión propia, el valor por defecto del código deja de aplicarse.
// Inyectadas por código, el mapa sigue funcionando se edite lo que se edite.
export const REGLAS_MAPA = `Cómo usar el mapa del portal:
- Si te preguntan dónde está algo, dónde se hace algo o cómo llegar a una pantalla, responde con el sitio exacto del mapa: por qué menú entra, en qué grupo está y el nombre tal y como aparece escrito ahí.
- El mapa es de ESTE negocio y de ESTE usuario. No nombres pantallas, módulos ni menús que no estén en él, ni los busques por otro nombre.
- Si lo que te piden no aparece en el mapa, dilo con naturalidad y ofrécele escribir a Soporte. Puede ser que no lo tenga contratado o que su usuario no lo vea; nunca supongas dónde estaría.
- No te inventes lo que pasa DENTRO de la pantalla (botones, campos, pestañas, el orden de los pasos). Llévale al sitio y dile qué va a encontrar; el detalle lo ve él allí.`
