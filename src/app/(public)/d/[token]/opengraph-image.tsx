import { ImageResponse } from 'next/og'
import { obtenerDeckPublico } from '@/app/actions/portal/dossier'

// ── Tarjeta al compartir el enlace del deck (1200×630) ───────────────────────
//
// Sin esto, un dossier compartido por WhatsApp/Telegram sale como un enlace pelado.
// La tarjeta lleva el nombre del negocio + «Dossier para inversores» sobre el color
// de marca del propio dossier. PRIVACIDAD: revela el nombre, pero el dueño ya lo
// revela al compartir el enlace; la página sigue con noindex/no-referrer.
//
// NOTA: ImageResponse (satori) SOLO admite estilos inline — es un renderizador de
// imagen aparte del design system, no UI de la app, así que la regla de «sin estilos
// inline» no aplica aquí.
export const alt = 'Dossier para inversores'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

// Hex #rgb/#rrggbb → {r,g,b}; null si no es válido.
function hexRgb(hex: string): { r: number; g: number; b: number } | null {
  const h = hex.trim().replace('#', '')
  const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return null
  return { r: parseInt(full.slice(0, 2), 16), g: parseInt(full.slice(2, 4), 16), b: parseInt(full.slice(4, 6), 16) }
}
const rgbStr = ({ r, g, b }: { r: number; g: number; b: number }) => `rgb(${r}, ${g}, ${b})`
const oscurecer = ({ r, g, b }: { r: number; g: number; b: number }, f: number) =>
  ({ r: Math.round(r * f), g: Math.round(g * f), b: Math.round(b * f) })
// Luminancia relativa (sRGB simple) → texto claro u oscuro para que se lea sobre el color.
function textoSobre(rgb: { r: number; g: number; b: number }): string {
  const L = (0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b) / 255
  return L > 0.6 ? '#14171A' : '#F8F7F2'
}

interface Props { params: Promise<{ token: string }> }

export default async function DeckOgImage({ params }: Props) {
  const { token } = await params
  const deck = await obtenerDeckPublico(token)

  const base = (deck && hexRgb(deck.color)) || { r: 0, g: 175, b: 170 }   // fallback: teal CLAUX
  const oscuro = oscurecer(base, 0.6)
  const texto = textoSobre(base)
  const nombre = deck?.nombre || 'Dossier'
  const tenue = texto === '#F8F7F2' ? 'rgba(248, 247, 242, 0.88)' : 'rgba(20, 23, 26, 0.82)'

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: '80px',
          background: `linear-gradient(135deg, ${rgbStr(base)} 0%, ${rgbStr(oscuro)} 100%)`,
          color: texto,
          fontFamily: 'sans-serif',
        }}
      >
        <div style={{ fontSize: '30px', fontWeight: 700, letterSpacing: '2px', opacity: 0.9 }}>
          DOSSIER PARA INVERSORES
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div style={{ fontSize: '84px', fontWeight: 800, lineHeight: 1.02, letterSpacing: '-2px', maxWidth: '1040px' }}>
            {nombre}
          </div>
          <div style={{ fontSize: '32px', color: tenue }}>
            Números, márgenes y proyección — en una presentación.
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '14px', fontSize: '26px', fontWeight: 600, opacity: 0.9 }}>
          <div
            style={{
              width: '46px', height: '46px', borderRadius: '11px',
              background: texto, color: rgbStr(oscuro),
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '28px', fontWeight: 800,
            }}
          >
            C
          </div>
          Hecho con CLAUX
        </div>
      </div>
    ),
    { ...size },
  )
}
