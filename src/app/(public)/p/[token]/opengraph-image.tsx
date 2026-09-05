import { ImageResponse } from 'next/og'
import { cargarPropuestaPublica } from '@/lib/propuesta/cargar'

// ── Tarjeta al compartir la propuesta (1200×630) ─────────────────────────────
//
// La propuesta se manda por WhatsApp, casi siempre al móvil del dueño. Sin esto
// llega un enlace pelado a un dominio que no conoce, y un enlace pelado a un
// dominio desconocido no se abre. Con la tarjeta llega con su nombre y con el
// de CLAUX debajo.
//
// PRIVACIDAD: se enseña el nombre del negocio y nada más — ni precios, ni
// módulos, ni quién lo firma. Quien recibe el enlace ya sabe de qué negocio es;
// quien lo reenvíe por error no filtra la negociación. La página sigue con
// noindex y no-referrer.
//
// NOTA: ImageResponse (satori) SOLO admite estilos inline — es un renderizador
// de imagen aparte del design system, no UI de la app, así que la regla de «sin
// estilos inline» no aplica aquí.
export const alt = 'Propuesta CLAUX'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

// El verde de la portada, escrito aquí a pelo: satori no lee variables CSS, así
// que no puede salir de `propuesta-publica.css`. Si allí cambia la paleta, esto
// hay que tocarlo a mano — son dos valores y el alternativo era cargar la hoja.
const VERDE = '#0b3b36'
const VERDE_HONDO = '#062421'
const TEAL = '#00afaa'
const CREMA = '#fdf8ee'

interface Props { params: Promise<{ token: string }> }

export default async function PropuestaOgImage({ params }: Props) {
  const { token } = await params
  const p = await cargarPropuestaPublica(token)
  // Un token muerto no puede delatar que lo estuvo: la tarjeta genérica sale
  // igual, y el 404 lo da la página.
  const nombre = p?.nombreNegocio || 'Tu negocio'

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%', height: '100%', display: 'flex', flexDirection: 'column',
          justifyContent: 'space-between', padding: '80px',
          background: `linear-gradient(135deg, ${VERDE} 0%, ${VERDE_HONDO} 100%)`,
          color: CREMA, fontFamily: 'sans-serif',
        }}
      >
        <div style={{ fontSize: '30px', fontWeight: 700, letterSpacing: '2px', color: TEAL }}>
          PROPUESTA DE DIGITALIZACIÓN
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div style={{ fontSize: '84px', fontWeight: 800, lineHeight: 1.02, letterSpacing: '-2px', maxWidth: '1040px' }}>
            {nombre}
          </div>
          <div style={{ fontSize: '32px', color: 'rgba(253, 248, 238, 0.82)' }}>
            Lo que hemos entendido de tu negocio, y lo que te proponemos.
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '14px', fontSize: '26px', fontWeight: 600 }}>
          <div
            style={{
              width: '46px', height: '46px', borderRadius: '11px',
              background: TEAL, color: VERDE_HONDO,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '28px', fontWeight: 800,
            }}
          >
            C
          </div>
          CLAUX
        </div>
      </div>
    ),
    { ...size },
  )
}
