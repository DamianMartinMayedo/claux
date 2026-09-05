// ── Quién firma una propuesta, y con qué contacto ────────────────────────────
//
// La propuesta la presenta una PERSONA, y lo que el cliente lee en la portada y
// en el cierre es su nombre, su correo y su WhatsApp. Eso no puede salir de la
// cuenta de acceso: las cuentas del equipo son correos personales, y un gmail
// personal en un documento comercial es peor que no poner ninguno.
//
// De ahí las dos piezas de aquí:
//
//  · el CONTACTO DE TRABAJO de cada persona (`admin_users.email_publico` /
//    `.telefono_publico`, mig. 233), que es lo que se enseña; vacío cae al de la
//    empresa, así que el día uno ya firma bien sin que nadie rellene nada;
//  · la LISTA del equipo, para que el comercial elija quién la presenta en vez
//    de teclear tres campos a mano.
//
// Vive en `lib/` y no en la acción porque lo usan las dos: la que crea la
// propuesta (para dejar la firma congelada) y la que pinta el editor.

import 'server-only'
import { leerSetting } from '@/lib/settings'
import { CLAVES_PROVEEDOR } from '@/lib/documentos/proveedor'

/* eslint-disable @typescript-eslint/no-explicit-any */
type Db = any

/** Una persona del equipo, tal como se ofrece en el selector «Quién la presenta». */
export interface Firmante {
  /** El correo de ACCESO. Identifica la fila; no se enseña nunca al cliente. */
  cuenta: string
  nombre: string
  /** Ya resuelto: el suyo si lo tiene, el de la empresa si no. */
  email: string | null
  tel:   string | null
  /** true si el contacto que se ofrece es el de la empresa, no el suyo. */
  usaContactoEmpresa: boolean
}

/** Lo que se congela en la propuesta. Los tres pueden ir vacíos: lo que está en
 *  blanco no se pinta en ninguna diapositiva. */
export interface Firma {
  nombre: string | null
  email:  string | null
  tel:    string | null
}

const limpiar = (s: string | null | undefined) => (s ?? '').trim() || null

/** El contacto de la empresa: el respaldo de todo el mundo. */
export async function contactoEmpresa(): Promise<{ email: string | null; tel: string | null }> {
  const [email, tel] = await Promise.all([
    leerSetting(CLAVES_PROVEEDOR.email, ''),
    leerSetting(CLAVES_PROVEEDOR.telefono, ''),
  ])
  return { email: limpiar(email), tel: limpiar(tel) }
}

/** Emails super-admin de bootstrap (ADMIN_EMAILS). Vacío si no está configurada. */
function superAdminsBootstrap(): string[] {
  const raw = process.env.ADMIN_EMAILS?.trim()
  if (!raw) return []
  return raw.split(',').map(e => e.trim().toLowerCase()).filter(Boolean)
}

/**
 * El equipo que puede figurar como quien presenta una propuesta.
 *
 * Sale de las mismas dos fuentes que el control de acceso (`roles-server.ts`) y
 * con la misma regla, porque si no la lista y la realidad se separan: las filas
 * de `admin_users` MÁS las cuentas de Supabase Auth que no tienen fila y aun así
 * entran al panel —las «cuentas base», que son super admin por ADMIN_EMAILS o,
 * si esa variable no está puesta, por el fail-open histórico—. Copiar la regla
 * es feo; deducirla mal deja fuera del selector justo a los dos socios.
 */
export async function listarFirmantes(db: Db): Promise<Firmante[]> {
  const [filasRes, authRes, empresa] = await Promise.all([
    db.from('admin_users').select('email, nombre, activo, email_publico, telefono_publico'),
    db.auth.admin.listUsers({ page: 1, perPage: 200 }),
    contactoEmpresa(),
  ])

  const conFila = new Set<string>()
  const out: Firmante[] = []

  const armar = (cuenta: string, nombre: string, propio: { email: string | null; tel: string | null }) => {
    const email = propio.email ?? empresa.email
    const tel   = propio.tel   ?? empresa.tel
    out.push({ cuenta, nombre, email, tel, usaContactoEmpresa: !propio.email && !propio.tel })
  }

  for (const f of (filasRes.data ?? []) as any[]) {
    const cuenta = String(f.email).toLowerCase()
    conFila.add(cuenta)
    // Una cuenta desactivada no vende: no se ofrece para firmar. La propuesta
    // que ya firmó no se toca —la firma está congelada— y eso es lo correcto:
    // el documento lo presentó quien lo presentó.
    if (f.activo === false) continue
    armar(cuenta, limpiar(f.nombre) ?? cuenta.split('@')[0], {
      email: limpiar(f.email_publico), tel: limpiar(f.telefono_publico),
    })
  }

  const whitelist = superAdminsBootstrap()
  for (const u of (authRes.data?.users ?? []) as any[]) {
    const cuenta = (u.email ?? '').toLowerCase()
    if (!cuenta || conFila.has(cuenta)) continue
    if (whitelist.length > 0 && !whitelist.includes(cuenta)) continue
    armar(cuenta, limpiar(u.user_metadata?.full_name) ?? cuenta.split('@')[0], { email: null, tel: null })
  }

  return out.sort((a, b) => a.nombre.localeCompare(b.nombre))
}

/**
 * La firma de una persona concreta, con el respaldo de la empresa ya aplicado.
 *
 * `nombreSesion` es el de la sesión y solo se usa si la cuenta no tiene fila:
 * una cuenta base no tiene dónde guardar su nombre más que en Supabase Auth.
 */
export async function firmaDe(db: Db, cuenta: string, nombreSesion: string): Promise<Firma> {
  const correo = (cuenta || '').trim().toLowerCase()
  const [fila, empresa] = await Promise.all([
    correo
      ? db.from('admin_users').select('nombre, email_publico, telefono_publico')
          .eq('email', correo).maybeSingle()
      : Promise.resolve({ data: null }),
    contactoEmpresa(),
  ])
  const f = fila?.data as { nombre?: string; email_publico?: string; telefono_publico?: string } | null
  return {
    nombre: limpiar(f?.nombre) ?? limpiar(nombreSesion),
    email:  limpiar(f?.email_publico)    ?? empresa.email,
    tel:    limpiar(f?.telefono_publico) ?? empresa.tel,
  }
}
