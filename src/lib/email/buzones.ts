// Lista de buzones internos, en un módulo PURO (sin Resend ni Supabase): lo
// necesitan a la vez el envío —servidor— y el formulario del admin —cliente—, y
// `enviar.ts` no puede cruzar esa frontera: arrastra `createAdminClient` y con él
// la service-role key al bundle del navegador.

/**
 * Separa los buzones de un setting: coma, punto y coma o salto de línea. Se
 * admiten los tres porque el que escribe la lista no tiene por qué saber cuál
 * esperamos, y pegar desde otro sitio trae el separador que trae.
 *
 * Si no queda ninguno cae en `porDefecto` — un aviso interno sin destino es un
 * aviso perdido, y el fallo se notaría tarde y mal—. Salvo que `porDefecto` sea
 * la cadena vacía, que significa «esta lista puede estar vacía»: devolver `['']`
 * ahí pintaría una pastilla en blanco y guardaría un destinatario fantasma.
 */
export function buzonesDe(valor: string, porDefecto: string): string[] {
  const lista = [...new Set(
    valor.split(/[,;\n]+/).map((s) => s.trim()).filter(Boolean),
  )]
  if (lista.length) return lista
  return porDefecto ? [porDefecto] : []
}
