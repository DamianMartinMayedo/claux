// Lista de buzones internos, en un módulo PURO (sin Resend ni Supabase): lo
// necesitan a la vez el envío —servidor— y el formulario del admin —cliente—, y
// `enviar.ts` no puede cruzar esa frontera: arrastra `createAdminClient` y con él
// la service-role key al bundle del navegador.

/**
 * Separa los buzones de un setting: coma, punto y coma o salto de línea. Se
 * admiten los tres porque el que escribe la lista no tiene por qué saber cuál
 * esperamos, y pegar desde otro sitio trae el separador que trae.
 *
 * Devuelve `[porDefecto]` si no queda ninguno: un aviso interno sin destino es
 * un aviso perdido, y el fallo se notaría tarde y mal.
 */
export function buzonesDe(valor: string, porDefecto: string): string[] {
  const lista = [...new Set(
    valor.split(/[,;\n]+/).map((s) => s.trim()).filter(Boolean),
  )]
  return lista.length ? lista : [porDefecto]
}
