import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { obtenerContextoAdmin } from '@/lib/roles-server'
import { RUTA_MANUAL } from '@/lib/roles'
import { MARCA_LARGA } from '@/lib/academia/marca'
import LoginCuenta from '@/components/LoginCuenta'

/**
 * La puerta del manual: la dirección que se le da a quien vende CLAUX desde
 * fuera. Se llama `/partners` porque es lo que se dice de viva voz —«te paso el
 * acceso de partner»— y una dirección que ya se ha repartido no se cambia.
 *
 * Es una sola URL y hace las dos cosas que hacen falta —si ya hay sesión, entra
 * al manual; si no, pide las credenciales—, porque quien la recibe no tiene por
 * qué saber distinguir entre «la web» y «el login de la web».
 *
 * No monta un sistema de cuentas aparte: usa el mismo (Supabase Auth +
 * `admin_users`) que el equipo, y son los PERMISOS de la fila los que deciden
 * qué más hay detrás del manual. Por eso el destino es `/academia` y no una
 * copia bajo esta ruta: una sola dirección por apartado sirve para todos, y un
 * enlace pegado en un mensaje lleva a los dos al mismo sitio.
 *
 * Lo que se lee dentro NO lo decide esta puerta sino la capa del rol: entrar por
 * aquí no enseña nada que no enseñe `/admin`, y al revés.
 */

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: MARCA_LARGA,
  robots: { index: false, follow: false },
}

export default async function PartnersPuerta() {
  const ctx = await obtenerContextoAdmin()
  // Vale cualquier cuenta autorizada: el equipo también abre esta dirección para
  // comprobar qué se encuentra quien la recibe.
  if (ctx) redirect(RUTA_MANUAL)

  return (
    <LoginCuenta
      subtitulo={MARCA_LARGA}
      destino={RUTA_MANUAL}
      pie="El manual del producto, para quien lo vende"
    />
  )
}
