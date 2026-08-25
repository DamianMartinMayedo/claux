// ── Tipos del health-check de modelos de IA (compartidos servidor/cliente) ──
// Viven aparte a propósito: los consumen el route handler, la página de admin y el
// cron, y ninguno de los tres debe arrastrar el cliente de Supabase de `modelo.ts`.

/** Techo de espera de un modelo, y a la vez la definición de «sirve».
 *
 *  No es una cifra técnica sino una decisión de producto: si no contesta dentro de este
 *  tiempo, da igual que acabe contestando — no vale para atender a un cliente y hay que
 *  tirar del respaldo. `gemini-3.7-flash` saturado llegó a tardar **150 s** (medido el
 *  2026-08-25): responde, pero eso no es un servicio, menos aún en Cuba.
 *
 *  Se aplica a las dos rutas, la prueba del admin y la consulta real del cliente, para
 *  que lo que ves al probar sea exactamente lo que le va a pasar al cliente. */
export const PRUEBA_LENTA_MS = 20_000

// vivo = responde con texto dentro del techo · lento = agotó el techo sin contestar:
// no está caído, pero no sirve · mudo = 200 sin texto (razonamiento) · caido = error
// explícito del proveedor (404, 503, key mal…)
export type EstadoPrueba = 'vivo' | 'lento' | 'mudo' | 'caido'

export interface PruebaModeloUI { estado: EstadoPrueba; ms: number; detalle?: string }
export type PruebaModeloResp = { ok: true; prueba: PruebaModeloUI } | { ok: false; error: string }
