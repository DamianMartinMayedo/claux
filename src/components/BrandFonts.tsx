import { Bricolage_Grotesque, IBM_Plex_Sans } from 'next/font/google'

// Fuentes de marca: Bricolage Grotesque (display) + IBM Plex Sans (body).
//
// Se descargan en el BUILD y se sirven desde nuestro propio dominio. Antes venían
// de Google, y eso costaba dos conexiones nuevas (fonts.googleapis.com para la
// hoja y fonts.gstatic.com para los ficheros) con su DNS y su TLS, encadenadas: el
// navegador no sabía qué ficheros pedir hasta que llegaba la hoja, que además
// bloquea el pintado. Con la latencia de Cuba eso es medio segundo largo mirando
// una pantalla en blanco, antes de empezar a bajar nada de lo nuestro.
//
// Se cargan SOLO en las superficies internas (portal/admin) y de marketing
// (landing, legales, diagnóstico, Academia, ayuda). NUNCA en las rutas públicas
// por-negocio: esas van con system-ui (regla de públicas, CONTEXTO §3 /
// skills/ui/SKILL.md §6). Lo que garantiza el aislamiento es que el `import` viva
// AQUÍ y no en el layout raíz: el @font-face y su <link rel="preload"> solo entran
// en el bundle de las rutas que montan este componente.
const display = Bricolage_Grotesque({
  subsets: ['latin'],
  // El eje óptico ya venía en la URL de Google y el navegador lo ajusta solo al
  // tamaño del texto (`font-optical-sizing: auto`, por defecto). Sin él los
  // titulares grandes se dibujarían con el corte pensado para 14 px.
  axes: ['opsz'],
  display: 'swap',
})

// La cursiva la piden el portal (notas al pie de tabla, «sin categoría», turnos
// libres) y el manual de la Academia, que llega en markdown y trae énfasis. Las
// superficies que NO escriben nada en cursiva —landing, legales, diagnóstico,
// deck— montan <BrandFontsSinCursiva> y se ahorran sus 45 KB de precarga.
const body = IBM_Plex_Sans({
  subsets: ['latin'],
  style: ['normal', 'italic'],
  display: 'swap',
})

// Las familias se publican como variables en `:root` y NO como clase en un <div>
// envolvente, que es la forma habitual: aquí no vale, porque los modales y los
// toasts se pintan con createPortal colgando de <body> y se quedarían fuera del
// div —sin fuente de marca y sin que nada fallara—. Los nombres `--fuente-*` son
// exclusivos de este componente, así que no compiten con nada en la cascada: quien
// los consume es `--font-display` / `--font-body` en 01-tokens.css.
const VARIABLES = `:root{--fuente-display:${display.style.fontFamily};--fuente-body:${body.style.fontFamily}}`

export default function BrandFonts() {
  return <style dangerouslySetInnerHTML={{ __html: VARIABLES }} />
}
