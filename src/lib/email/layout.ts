// Envoltorio de marca para todos los correos de CLAUX. Vive en código (no editable
// desde el admin): garantiza que todo salga on-brand y que nadie rompa el HTML.
// El HTML de email no soporta custom properties ni hojas externas — los valores
// están tomados a mano de src/app/styles/01-tokens.css (modo claro, fijo).
// Al ser una copia, no se entera de los cambios de la marca: si tocas los tokens,
// pasa por aquí. Copia SIEMPRE la variante de tinta (`-text`), no la de cromo:
// aquí todo son enlaces y texto sobre fondo claro, nunca rellenos grandes.

const TEAL_TEXT  = '#00716D'   // = --color-primary-text
const AMBER      = '#B45309'   // = --color-amber-text (antes #C97A0C: 3.05:1 sobre BG, no llegaba a AA)
const TEXT       = '#1C1B16'
const TEXT_MUTED = '#5C5B52'
const BG         = '#F5F4EF'
const SURFACE    = '#FFFFFF'
const BORDER     = '#D9D7D0'

// Convierte texto plano (con \n\n como separador de párrafo) a HTML seguro.
export function textoAHtml(texto: string): string {
  const escapado = texto
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
  return escapado
    .split(/\n{2,}/)
    .map(parrafo => `<p style="margin:0 0 16px;">${parrafo.replace(/\n/g, '<br>')}</p>`)
    .join('')
}

export function envolverEmail(cuerpoHtml: string): string {
  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:${BG};font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BG};padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:${SURFACE};border-radius:12px;overflow:hidden;border:1px solid ${BORDER};">
            <tr>
              <td style="padding:24px 32px;border-bottom:1px solid ${BORDER};">
                <span style="font-size:20px;font-weight:700;color:${TEAL_TEXT};letter-spacing:-0.02em;">CLAUX</span>
              </td>
            </tr>
            <tr>
              <td style="padding:32px;color:${TEXT};font-size:15px;line-height:1.6;">
                ${cuerpoHtml}
              </td>
            </tr>
            <tr>
              <td style="padding:20px 32px;border-top:1px solid ${BORDER};background:${BG};">
                <p style="margin:0;font-size:12px;color:${TEXT_MUTED};">
                  CLAUX · Plataforma para digitalizar tu negocio ·
                  <a href="https://claux.es" style="color:${AMBER};text-decoration:none;">claux.es</a>
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`
}
