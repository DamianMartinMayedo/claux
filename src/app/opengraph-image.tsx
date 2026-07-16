import { ImageResponse } from 'next/og'

// Imagen Open Graph de marca para landing y diagnóstico (1200×630).
// NOTA: ImageResponse (satori) SOLO admite estilos inline — es un renderizador
// de imagen aparte del design system, no UI de la app, así que la regla de
// "sin estilos inline" no aplica aquí. Colores de marca CLAUX.
export const alt = 'CLAUX — Digitaliza tu negocio'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

export default function OpengraphImage() {
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
          // Eco de --gradient-band: tonos estables de marca con texto claro encima.
          // Copiado a mano porque Satori no ve los tokens; si tocas la rampa, pasa
          // por aquí. El ámbar es el `-active` (#B45309) y no el vivo: sobre este
          // fondo va texto casi blanco, y el ámbar vivo lo dejaría en 2.1:1.
          // Satori tampoco entiende `in oklch`, así que esto interpola en sRGB y el
          // tramo teal→ámbar pasa por un caqui apagado. Se asume: es una miniatura.
          background: 'linear-gradient(135deg, #00716D 0%, #00AFAA 60%, #B45309 140%)',
          color: '#F8F7F2',
          fontFamily: 'sans-serif',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
          <div
            style={{
              width: '72px',
              height: '72px',
              borderRadius: '16px',
              background: '#F8F7F2',
              color: '#00716D',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '44px',
              fontWeight: 800,
            }}
          >
            C
          </div>
          <div style={{ fontSize: '40px', fontWeight: 800, letterSpacing: '-1px' }}>CLAUX</div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          <div style={{ fontSize: '68px', fontWeight: 800, lineHeight: 1.05, letterSpacing: '-2px', maxWidth: '900px' }}>
            Digitaliza tu negocio
          </div>
          <div style={{ fontSize: '32px', opacity: 0.92, maxWidth: '880px', lineHeight: 1.3 }}>
            Contabilidad, catálogo con QR, reservas y un asistente con IA. Todo en una plataforma.
          </div>
        </div>

        <div style={{ fontSize: '26px', fontWeight: 600, opacity: 0.9 }}>
           Diagnóstico gratis · Precios justos · Módulos a tu medida
        </div>
      </div>
    ),
    { ...size },
  )
}
