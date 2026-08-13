// ── Política del catálogo: quién crea RAÍCES (renglones del estado de resultados)
//
// Decisión de producto (2026-08-13, ronda con Claudia). Las RAÍCES del catálogo
// SON los renglones del estado de resultados y las fija CLAUX: se siembran por tipo
// de negocio (el asistente, F1.3) y solo el SISTEMA las crea sobre la marcha
// (`cat_gasto_sistema`: la primera compra crea G1/G2, la nómina crea Salarios…). El
// dueño solo pone DETALLE —subcategorías, que heredan el rol de su raíz y NO añaden
// líneas al informe—. Menos raíces inventadas = base sólida y dossier limpio.
//
// El camino viejo —crear una raíz a mano eligiendo su renglón, con las preguntas de
// rol— NO se borra. Queda entero detrás de este interruptor para poder recuperarlo
// TAL CUAL si algún día se reabre. En `false`:
//   · la interfaz no ofrece «categoría principal nueva» (solo subcategorías), y
//   · el servidor (`guardarCategoriaGasto`) rechaza el alta de una raíz a mano
//     —ocultar el botón no basta: «UI oculta no es control de acceso»—.
//
// Encender es UNA línea: `true` y vuelve a estar disponible de punta a punta.
// Este flag NO afecta a las raíces del sistema (RPC) ni al importador (migración
// admin), que reconstruyen el pasado y se reconcilian luego con el asistente.
export const PERMITIR_RAIZ_MANUAL = false
