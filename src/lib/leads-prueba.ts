// ── Detector de solicitudes de prueba (heurística que PROPONE, nunca borra) ───
//
// El diagnóstico es un formulario público que solo valida el formato del correo,
// así que cada prueba de desarrollo deja una fila indistinguible de un lead real:
// «sss · 3 · e@f.com». En producción son 24 de 27, y repasarlas de una en una es
// justo lo que hace que nadie limpie nunca.
//
// Esto NO decide: marca. La pantalla preselecciona con estas pistas y la persona
// confirma. Borrar un lead real por una regla de tres cuesta mucho más que
// repasar una lista corta, así que cuando dude, que no marque.

export type PistaPrueba = 'nombre' | 'telefono' | 'correo' | 'repetido'

export interface LeadPosible {
  id:       number
  nombre:   string
  email:    string | null
  telefono: string
}

const TECLEADOS = /^(test|prueba|ejemplo|demo|asdf|qwer)/i

/** Nombre de dos teclas: «w», «sss», «dddd», «test 1», «ejemplo de caja». */
function nombreDePrueba(nombre: string): boolean {
  const n = nombre.trim()
  if (n.length <= 3) return true
  if (/^(\S)\1+$/.test(n)) return true
  return TECLEADOS.test(n)
}

/** Menos de 8 dígitos no es un móvil cubano (8) ni español (9): es un tecleo. */
function telefonoDePrueba(telefono: string): boolean {
  return (telefono.match(/\d/g) ?? []).length < 8
}

/** «e@f.com», «3@gmail.com», «tu@g.no»: el correo que se escribe para pasar de pantalla. */
function correoDePrueba(email: string | null): boolean {
  const e = (email ?? '').trim().toLowerCase()
  if (!e) return true
  const [local, dominio = ''] = e.split('@')
  if (local.length <= 2) return true
  if (/^\d+$/.test(local)) return true
  return (dominio.split('.')[0] ?? '').length <= 2
}

/**
 * Las pistas de cada lead, indexadas por id. Se calcula todo de una vez porque
 * `repetido` mira la lista entera: un correo que aparece en tres solicitudes es
 * alguien probando el formulario, y esa es la única pista que caza al que probó
 * con su nombre y su teléfono de verdad.
 */
export function pistasDePrueba(leads: LeadPosible[]): Map<number, PistaPrueba[]> {
  const veces = new Map<string, number>()
  for (const l of leads) {
    const e = (l.email ?? '').trim().toLowerCase()
    if (e) veces.set(e, (veces.get(e) ?? 0) + 1)
  }

  const pistas = new Map<number, PistaPrueba[]>()
  for (const l of leads) {
    const p: PistaPrueba[] = []
    if (nombreDePrueba(l.nombre)) p.push('nombre')
    if (telefonoDePrueba(l.telefono)) p.push('telefono')
    if (correoDePrueba(l.email)) p.push('correo')
    const e = (l.email ?? '').trim().toLowerCase()
    if (e && (veces.get(e) ?? 0) > 1) p.push('repetido')
    if (p.length) pistas.set(l.id, p)
  }
  return pistas
}

const TEXTO: Record<PistaPrueba, string> = {
  nombre:   'nombre de prueba',
  telefono: 'teléfono incompleto',
  correo:   'correo de usar y tirar',
  repetido: 'correo repetido en varias solicitudes',
}

/** Por qué se propone, en palabras: va en el `title` del distintivo. */
export function explicarPistas(pistas: PistaPrueba[]): string {
  return pistas.map((p) => TEXTO[p]).join(' · ')
}
