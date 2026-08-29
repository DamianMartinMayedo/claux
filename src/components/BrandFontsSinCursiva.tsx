import { Bricolage_Grotesque, IBM_Plex_Sans } from 'next/font/google'

// Las mismas fuentes que <BrandFonts> (mira allí el porqué de servirlas desde
// nuestro dominio y de publicarlas como variables de `:root`), pero SIN la
// cursiva. next/font precarga todos los cortes que declaras, y la cursiva latina
// son 45 KB que estas superficies bajarían en cada visita para no pintar ni una
// letra inclinada.
//
// La usan la landing, los legales, el diagnóstico y el deck del dossier: ninguno
// tiene un `font-style: italic` en su CSS ni un <em> en su árbol. Las de gestión
// (portal, admin) y las de contenido (Academia, ayuda) sí lo necesitan —las notas
// en cursiva del portal, la cursiva del manual en markdown— y usan <BrandFonts>.
//
// ⚠️ Si alguna de estas cuatro pasa a escribir texto en cursiva, cámbiala a
// <BrandFonts>: si no, el navegador se inventará la inclinación deformando la
// redonda y nadie verá saltar nada.
//
// Los ficheros son los mismos que sirve <BrandFonts>, así que quien llega a la
// landing y luego entra al portal no vuelve a descargar la redonda.
const display = Bricolage_Grotesque({ subsets: ['latin'], axes: ['opsz'], display: 'swap' })
const body = IBM_Plex_Sans({ subsets: ['latin'], display: 'swap' })

const VARIABLES = `:root{--fuente-display:${display.style.fontFamily};--fuente-body:${body.style.fontFamily}}`

export default function BrandFontsSinCursiva() {
  return <style dangerouslySetInnerHTML={{ __html: VARIABLES }} />
}
