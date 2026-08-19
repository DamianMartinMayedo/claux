// ── Núcleo de render de documentos legales (NDA, contrato, presupuesto) ──
//
// Fuente ÚNICA e isomórfica: el mismo `DocumentoResuelto` alimenta la pantalla
// del portal (modal de firma), el PDF firmado y el hash que sella lo aceptado.
// Si cada lado construyera el texto por su cuenta, el hash guardado dejaría de
// corresponder con lo que el cliente vio o con lo que dice el PDF.
//
// El HASH se calcula solo sobre `cuerpo` (los términos), NUNCA sobre la fecha ni
// el sello de firma: esos cambian en el acto de firmar, y el hash debe pintar
// QUÉ se aceptó, no cuándo. Misma versión de plantilla + mismos datos ⇒ mismo
// hash, en cliente y en servidor.

export type TipoDocumento = 'nda' | 'contrato' | 'presupuesto'

/** Un elemento del cuerpo del documento. Lo consumen render, PDF y hash igual. */
export type Elemento =
  | { tipo: 'seccion'; titulo?: string; parrafos: string[] }
  | { tipo: 'lista'; titulo?: string; items: string[] }
  | { tipo: 'tabla'; titulo?: string; columnas: string[]; filas: string[][]; nota?: string }

export interface DatosCliente {
  /** Nombre comercial de la cuenta (fallback si no hay razón social). */
  nombre_empresa:       string
  /** Datos fiscales oficiales, que el cliente rellena antes de firmar. */
  razon_social:         string
  nif:                  string
  domicilio_fiscal:     string
  representante_nombre: string
  representante_doc:    string
  email:                string
}

/** Frase de identificación del Cliente para la cláusula «Partes»: empresa (razón
 *  social + NIF + domicilio fiscal) y representante (nombre + documento). */
export function identificacionCliente(c: DatosCliente): string {
  const empresa = c.razon_social?.trim() || c.nombre_empresa
  const partes = [`${empresa}`]
  if (c.nif) partes.push(`con NIF ${c.nif}`)
  if (c.domicilio_fiscal) partes.push(`y domicilio fiscal en ${c.domicilio_fiscal}`)
  let frase = partes.join(' ') + ' (en adelante, «el Cliente»)'
  if (c.representante_nombre) {
    frase += `, representada por ${c.representante_nombre}`
    if (c.representante_doc) frase += `, con documento de identidad ${c.representante_doc}`
  }
  return frase + '.'
}

export interface DatosProveedor {
  nombre:    string
  nif:       string
  domicilio: string
  email:     string
  telefono:  string
  iae:       string
}

export interface DocumentoResuelto {
  tipo:       TipoDocumento
  version:    string
  titulo:     string
  subtitulo?: string
  /** El texto de los términos. Es lo ÚNICO que entra en el hash. */
  cuerpo:     Elemento[]
}

/**
 * SHA-256 hex del contenido de los términos. Serialización canónica: el orden de
 * los elementos y de las claves es estable, así que la misma entrada da el mismo
 * hash en el navegador y en el servidor (`crypto.subtle` existe en ambos).
 */
export async function hashDocumento(doc: DocumentoResuelto): Promise<string> {
  const canonical = JSON.stringify({ tipo: doc.tipo, version: doc.version, cuerpo: doc.cuerpo })
  const bytes = new TextEncoder().encode(canonical)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('')
}

/** Cláusula de aceptación electrónica (eIDAS / Ley 6/2020), común a NDA y contrato.
 *  `numero` es el ordinal de la cláusula en su documento (p. ej. 8 en el NDA, 15
 *  en el contrato), para que el título case con la numeración del resto. */
export function clausulaFirmaElectronica(numero: number): Elemento {
  return {
    tipo: 'seccion',
    titulo: `${numero}. Aceptación y firma electrónica`,
    parrafos: [
      'Las partes acuerdan que la aceptación de este documento a través de la plataforma CLAUX '
      + '—mediante la casilla de aceptación y el nombre del firmante, con registro de la fecha y '
      + 'hora, la dirección IP y la versión del documento aceptada— constituye una firma '
      + 'electrónica válida y vinculante conforme al Reglamento (UE) n.º 910/2014 (eIDAS) y a la '
      + 'Ley 6/2020, de 11 de noviembre, reguladora de determinados aspectos de los servicios '
      + 'electrónicos de confianza.',
      'Ambas partes reconocen la plena validez y eficacia probatoria de esta forma de aceptación y '
      + 'renuncian a impugnarla por el mero hecho de constar en formato electrónico. CLAUX conserva '
      + 'el registro de la aceptación como prueba de la firma.',
    ],
  }
}
