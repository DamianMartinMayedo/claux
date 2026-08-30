'use server'

// ── Firma de documentos legales del cliente (NDA, contrato, presupuesto) ──
//
// Self-service del portal, pero SOLO el representante legal (rol admin_empresa)
// puede firmar: un `usuario` u operador no compromete a la empresa. Ese check
// (`rol !== 'admin_empresa'`) es además el gate que exige `audit:gating` para
// toda acción que escribe (no necesita ALLOWLIST).
//
// El documento se RECONSTRUYE y se hashea en el servidor: lo que llegue del
// navegador (nombre, tipo) es dato de firma, no el contenido. El presupuesto se
// arma desde el `presupuestos_instalacion` aprobado del cliente y, si no lo hay,
// desde los módulos activos.

import { revalidatePath }    from 'next/cache'
import { headers }           from 'next/headers'
import { createAdminClient } from '@/lib/supabase/admin'
import { leerSetting }       from '@/lib/settings'
import { importeCiclo } from '@/lib/billing'
import { COLUMNAS_PRECIO, normalizarNivel, precioModulo, type ModuloPrecios } from '@/lib/niveles'
import { importeClaux, normalizarMonedaClaux, type MonedaClaux } from '@/lib/moneda-claux'
import { logActividad }      from '@/lib/audit'
import { clientIp }          from '@/lib/rate-limit'
import { getPortalSession }  from './auth'
import {
  hashDocumento,
  type DatosCliente, type DatosProveedor, type DocumentoResuelto, type TipoDocumento,
} from '@/lib/documentos/render'
import { obtenerDatosProveedor } from '@/lib/documentos/proveedor'
import { construirNda }      from '@/lib/documentos/plantillas/nda'
import { construirContrato } from '@/lib/documentos/plantillas/contrato'
import { construirPresupuestoAnexo, type AnexoInput, type LineaAnexo } from '@/lib/documentos/plantillas/presupuesto-anexo'

const TIPOS: TipoDocumento[] = ['nda', 'contrato', 'presupuesto']
const BUCKET = 'documentos-firmados'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any

// ── Datos fiscales de firma (los rellena el cliente antes de poder firmar) ──
export interface DatosFirma {
  razon_social:         string
  nif:                  string
  domicilio_fiscal:     string
  representante_nombre: string
  representante_doc:    string
}
function leerDatosFirma(raw: unknown): DatosFirma {
  const o = (raw && typeof raw === 'object') ? raw as Record<string, unknown> : {}
  return {
    razon_social:         String(o.razon_social ?? '').trim(),
    nif:                  String(o.nif ?? '').trim(),
    domicilio_fiscal:     String(o.domicilio_fiscal ?? '').trim(),
    representante_nombre: String(o.representante_nombre ?? '').trim(),
    representante_doc:    String(o.representante_doc ?? '').trim(),
  }
}
/** Los cinco campos son obligatorios para poder ver y firmar. (Interno: un
 *  fichero 'use server' solo puede EXPORTAR funciones async.) */
function datosFirmaCompletos(d: DatosFirma): boolean {
  return !!(d.razon_social && d.nif && d.domicilio_fiscal && d.representante_nombre && d.representante_doc)
}

export interface FirmaInfo {
  id:                 number
  version:            string
  doc_hash:           string
  firmado_at:         string
  firmado_por_nombre: string
  firmado_por_email:  string
  tiene_pdf:          boolean
}

export interface DocumentoEstado {
  tipo:      TipoDocumento
  contenido: DocumentoResuelto
  firmado:   boolean
  firma?:    FirmaInfo
}

export interface EstadoDocumentos {
  documentos:       DocumentoEstado[]
  proveedor:        DatosProveedor
  datosFirma:       DatosFirma
  datosCompletos:   boolean
  /** Datos bloqueados (solo lectura): ya hay una firma vigente. */
  datosBloqueados:  boolean
  /** Rol admin_empresa Y datos completos: solo entonces se puede firmar. */
  puedeFirmar:      boolean
  /** El usuario puede editar los datos fiscales (admin_empresa y no bloqueado). */
  puedeEditarDatos: boolean
  /** El usuario es el admin de la empresa (para mensajes de por qué no puede editar). */
  esAdmin:          boolean
  pendientes:       number
}

// ── Construcción del Anexo I (presupuesto) ──────────────────────────────────
const TIPO_LABEL: Record<string, string> = {
  base: 'Módulo', modulo: 'Módulo', funcionalidad: 'Funcionalidad', addon: 'Addon',
}

async function construirAnexoInput(
  db: Db, cid: string,
  cliente: { modulos_activos: string[]; precio_mensual: number; moneda: MonedaClaux; ciclo: string; nivel: string },
): Promise<AnexoInput> {
  const descuento = parseInt(await leerSetting('descuento_anual_pct', '10'), 10) || 0
  const ciclo = cliente.ciclo === 'anual' ? 'anual' : 'mensual'
  const periodicidad = ciclo === 'anual' ? 'Anual' : 'Mensual'
  const precioMes = Number(cliente.precio_mensual) || 0
  const moneda    = cliente.moneda
  const imp = (n: number) => importeClaux(n, moneda)

  // Preferimos el presupuesto de instalación APROBADO del cliente. El filtro por
  // estado no es cosmético: sin él, un borrador nuevo (`guardado`) tapaba al
  // aprobado y el cliente firmaba un Anexo con cifras que aún se estaban
  // negociando. Un borrador no es un acuerdo.
  const { data: presu } = await db
    .from('presupuestos_instalacion')
    .select('id, modulos, cuota_mensual, total_final, moneda, nivel, estado, created_at')
    .eq('client_id', cid)
    .in('estado', ['aprobado', 'instalado'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  // Nombres de los módulos desde el catálogo comercial (una sola fuente).
  const claves = (presu?.modulos?.length ? presu.modulos : cliente.modulos_activos) as string[]
  const { data: catalogo } = await db
    .from('modulos_catalogo')
    .select(`clave, nombre, tipo, ${COLUMNAS_PRECIO}, orden`)
    .in('clave', claves.length ? claves : ['__none__'])
    .order('orden')
  const filasCat = (catalogo ?? []) as (ModuloPrecios & { nombre: string; tipo: string; orden: number })[]
  // El nivel del presupuesto manda sobre el del cliente: el Anexo documenta lo que se
  // firmó, y si el cliente sube de nivel después, ese Anexo viejo no se reescribe solo.
  const nivel = presu?.nivel ?? cliente.nivel
  const precioDe = (m: typeof filasCat[number]) => precioModulo(m, nivel, moneda)

  const lineas: LineaAnexo[] = filasCat.map(m => {
    const p = precioDe(m)
    return { concepto: m.nombre, tipo: TIPO_LABEL[m.tipo] ?? 'Módulo', precio: p > 0 ? `${imp(p)}/mes` : 'Incluido' }
  })

  const importePeriodico = ciclo === 'anual'
    ? `${imp(importeCiclo(precioMes, 'anual', descuento))}/año`
    : `${imp(precioMes)}/mes`

  if (presu) {
    const totalInstal = Number(presu.total_final) || 0
    // La instalación se cotizó en la moneda DEL PRESUPUESTO, que no siempre es la
    // del cliente: puede haber presupuestos en las dos y la moneda de facturación
    // cambia de un mes a otro. Se conserva la del presupuesto en vez de reetiquetar
    // el importe, que sería cambiar la cifra pactada poniéndole otro símbolo.
    const monedaInstal = normalizarMonedaClaux(presu.moneda)
    const impInstal = (n: number) => importeClaux(n, monedaInstal)
    // Importe inicial = primer período + parte de configuración (50% al iniciar,
    // cláusula 6). Se muestra el total de configuración y su reparto en la nota.
    const primerPeriodo = ciclo === 'anual' ? importeCiclo(precioMes, 'anual', descuento) : precioMes
    const mitadInstal   = totalInstal * 0.5
    // Dos monedas no se suman: convertirlas al vuelo devolvería el número que trajo
    // todo esto —lo facturado y lo pagado sin coincidir—. Cuando difieren, el Anexo
    // dice las dos partes por separado y deja claro qué es cada una.
    const importeInicial = monedaInstal === moneda
      ? imp(primerPeriodo + mitadInstal)
      : `${imp(primerPeriodo)} (primer período) + ${impInstal(mitadInstal)} (50% de configuración)`
    // La versión sella el CONTENIDO, no el id: editar un borrador conserva el id
    // y con `presupuesto-<id>` a secas un Anexo firmado seguía contando como
    // firmado con otros números dentro. Cualquier cambio de moneda, ciclo, nivel,
    // módulos o importes mueve la versión y obliga a re-firmar (la firma vieja
    // queda en histórico como prueba de lo que se firmó). Esta cadena tiene que
    // coincidir carácter a carácter con la de las migraciones 204 y 225, que
    // renombraron las firmas vigentes para que nadie firmara dos veces lo mismo.
    const version = [
      `presupuesto-${presu.id}`,
      moneda.toLowerCase(),
      ciclo,
      nivel,
      [...claves].sort().join('+'),
      precioMes.toFixed(2),
      totalInstal.toFixed(2),
    ].join('-')

    return {
      version,
      fuente: 'presupuesto',
      moneda,
      lineas,
      periodicidad,
      importePeriodico,
      importeInicial,
      instalacion: totalInstal > 0
        ? { total: impInstal(totalInstal), nota: 'La configuración se paga en dos partes: 50% al iniciar y 50% al finalizar (cláusula 6).' }
        : undefined,
    }
  }

  // Fallback: sin presupuesto de instalación enlazado (cliente de prueba o alta
  // manual). El Anexo se autogenera desde los módulos activos, sin coste de
  // configuración. La versión codifica el contenido para que un cambio de
  // módulos/nivel exija una firma nueva.
  const primerPeriodo = ciclo === 'anual' ? importeCiclo(precioMes, 'anual', descuento) : precioMes
  const version = `modulos-${moneda.toLowerCase()}-${ciclo}-${[...cliente.modulos_activos].sort().join('+') || 'ninguno'}-${precioMes}`
  return {
    version,
    fuente: 'modulos',
    moneda,
    lineas,
    periodicidad,
    importePeriodico,
    importeInicial: imp(primerPeriodo),
  }
}

async function resolverDocumentos(db: Db, cid: string): Promise<{
  cliente: DatosCliente; proveedor: DatosProveedor; datosFirma: DatosFirma
  docs: Record<TipoDocumento, DocumentoResuelto>
} | null> {
  const { data: c } = await db
    .from('clients')
    .select('nombre_empresa, email_admin, datos_firma, modulos_activos, precio_mensual_usd, precio_mensual_eur, moneda_facturacion, ciclo_facturacion, nivel')
    .eq('client_id', cid)
    .single()
  if (!c) return null

  const datosFirma = leerDatosFirma(c.datos_firma)
  const cliente: DatosCliente = {
    nombre_empresa:       c.nombre_empresa,
    razon_social:         datosFirma.razon_social,
    nif:                  datosFirma.nif,
    domicilio_fiscal:     datosFirma.domicilio_fiscal,
    representante_nombre: datosFirma.representante_nombre,
    representante_doc:    datosFirma.representante_doc,
    email:                c.email_admin,
  }
  const proveedor = await obtenerDatosProveedor()
  // La moneda del Cliente manda en TODO el juego de documentos: el contrato dice en
  // cuál se factura (cláusula 5) y el Anexo la repite. Cambiarla mueve las dos
  // versiones y las firmas vigentes dejan de valer, que es justo lo que se pide.
  const moneda = normalizarMonedaClaux(c.moneda_facturacion)
  const anexo = await construirAnexoInput(db, cid, {
    modulos_activos: Array.isArray(c.modulos_activos) ? c.modulos_activos : [],
    precio_mensual: Number(moneda === 'EUR' ? c.precio_mensual_eur : c.precio_mensual_usd) || 0,
    moneda,
    ciclo: c.ciclo_facturacion ?? 'mensual',
    nivel: normalizarNivel(c.nivel),
  })

  return {
    cliente,
    proveedor,
    datosFirma,
    docs: {
      nda:         construirNda(cliente, proveedor),
      contrato:    construirContrato(cliente, proveedor, moneda),
      presupuesto: construirPresupuestoAnexo(cliente, proveedor, anexo),
    },
  }
}

// ── Estado de los documentos (solo lectura) ─────────────────────────────────
export async function estadoDocumentos(): Promise<EstadoDocumentos | null> {
  const session = await getPortalSession()
  if (!session) return null
  const db = createAdminClient()

  const resuelto = await resolverDocumentos(db, session.client_id)
  if (!resuelto) return null

  // Solo firmas VIGENTES (no caducadas): una firma caducada por una reapertura del
  // admin ya no cuenta y el documento vuelve a "pendiente".
  const { data: firmas } = await db
    .from('firmas_documentos')
    .select('id, tipo, version, doc_hash, firmado_at, firmado_por_nombre, firmado_por_email, pdf_path')
    .eq('client_id', session.client_id)
    .is('caducada_at', null)
  const firmaDe = new Map<string, Record<string, unknown>>()
  for (const f of (firmas ?? []) as Record<string, unknown>[]) firmaDe.set(f.tipo as string, f)

  const documentos: DocumentoEstado[] = TIPOS.map(tipo => {
    const contenido = resuelto.docs[tipo]
    const f = firmaDe.get(tipo)
    // Firmado solo si la firma vigente corresponde a la versión actual del documento:
    // si el presupuesto cambió, la firma vieja no cuenta y vuelve a "pendiente".
    const firmado = !!f && f.version === contenido.version
    return {
      tipo,
      contenido,
      firmado,
      firma: firmado ? {
        id:                 f!.id as number,
        version:            f!.version as string,
        doc_hash:           f!.doc_hash as string,
        firmado_at:         f!.firmado_at as string,
        firmado_por_nombre: f!.firmado_por_nombre as string,
        firmado_por_email:  f!.firmado_por_email as string,
        tiene_pdf:          !!f!.pdf_path,
      } : undefined,
    }
  })

  const datosCompletos = datosFirmaCompletos(resuelto.datosFirma)
  // Bloqueado en cuanto hay al menos una firma vigente: cambiar los datos rompería
  // la correspondencia con lo ya firmado. El admin puede reabrir (caduca las firmas).
  const datosBloqueados = (firmas ?? []).length > 0
  const esAdmin = session.rol === 'admin_empresa'

  return {
    documentos,
    proveedor: resuelto.proveedor,
    datosFirma: resuelto.datosFirma,
    datosCompletos,
    datosBloqueados,
    puedeFirmar: esAdmin && datosCompletos,
    puedeEditarDatos: esAdmin && !datosBloqueados,
    esAdmin,
    pendientes: documentos.filter(d => !d.firmado).length,
  }
}

// ── Guardar los datos fiscales de firma (self-service, admin de la empresa) ──
export async function guardarDatosFirma(formData: FormData): Promise<{ ok: boolean; error?: string }> {
  const session = await getPortalSession()
  if (!session) return { ok: false, error: 'Sesión inválida.' }
  if (session.rol !== 'admin_empresa') {
    return { ok: false, error: 'Solo el administrador de la empresa puede editar los datos de firma.' }
  }

  const db = createAdminClient()
  // No se pueden cambiar si ya hay una firma vigente (habría que reabrir desde admin).
  const { count } = await db
    .from('firmas_documentos')
    .select('*', { count: 'exact', head: true })
    .eq('client_id', session.client_id)
    .is('caducada_at', null)
  if ((count ?? 0) > 0) {
    return { ok: false, error: 'Los datos ya no se pueden cambiar: hay documentos firmados. Pide a CLAUX una reapertura.' }
  }

  const datos: DatosFirma = leerDatosFirma({
    razon_social:         formData.get('razon_social'),
    nif:                  formData.get('nif'),
    domicilio_fiscal:     formData.get('domicilio_fiscal'),
    representante_nombre: formData.get('representante_nombre'),
    representante_doc:    formData.get('representante_doc'),
  })
  if (!datosFirmaCompletos(datos)) {
    return { ok: false, error: 'Completa todos los campos: razón social, NIF, domicilio fiscal, nombre y documento del representante.' }
  }

  const { error } = await db.from('clients').update({ datos_firma: datos }).eq('client_id', session.client_id)
  if (error) return { ok: false, error: 'No se pudieron guardar los datos.' }

  await logActividad(db, {
    user_email: session.email, entity: 'firma', entity_id: session.client_id,
    action: 'guardar_datos_firma', description: `Guardó los datos fiscales de firma (${datos.razon_social}).`,
  })
  revalidatePath('/portal/perfil')
  return { ok: true }
}

// ── Firmar un documento ─────────────────────────────────────────────────────
export interface FirmarResultado {
  ok: boolean
  error?: string
  firma?: {
    id: number; version: string; docHash: string; firmadoAt: string
    firmadoPorNombre: string; firmadoPorEmail: string
  }
  contenido?: DocumentoResuelto
  proveedor?: DatosProveedor
}

export async function firmarDocumento(formData: FormData): Promise<FirmarResultado> {
  const session = await getPortalSession()
  if (!session) return { ok: false, error: 'Sesión inválida.' }
  // Solo el representante legal de la empresa firma (y gate de audit:gating).
  if (session.rol !== 'admin_empresa') {
    return { ok: false, error: 'Solo el administrador de la empresa puede firmar los documentos.' }
  }

  const tipo = String(formData.get('tipo') ?? '') as TipoDocumento
  if (!TIPOS.includes(tipo)) return { ok: false, error: 'Documento no válido.' }
  const nombre = String(formData.get('nombre') ?? '').trim()
  if (nombre.length < 3) return { ok: false, error: 'Escribe tu nombre completo para firmar.' }
  if (formData.get('acepto') !== 'true') return { ok: false, error: 'Debes marcar la casilla de aceptación.' }

  const db = createAdminClient()
  const resuelto = await resolverDocumentos(db, session.client_id)
  if (!resuelto) return { ok: false, error: 'No se pudo cargar el documento.' }

  // No se firma sin los datos fiscales completos (defensa en servidor; la UI ya
  // bloquea el botón, pero el gate real vive aquí).
  if (!datosFirmaCompletos(resuelto.datosFirma)) {
    return { ok: false, error: 'Antes de firmar debes completar tus datos fiscales.' }
  }

  const contenido = resuelto.docs[tipo]
  const docHash = await hashDocumento(contenido)
  const firmadoAt = new Date().toISOString()

  const ip = await clientIp()
  const ua = (await headers()).get('user-agent') ?? ''

  const { data: filaNueva, error } = await db.from('firmas_documentos').insert({
    client_id:          session.client_id,
    tipo,
    version:            contenido.version,
    doc_hash:           docHash,
    firmado_por_user:   session.user_id,
    firmado_por_nombre: nombre,
    firmado_por_email:  session.email,
    firmado_at:         firmadoAt,
    ip,
    user_agent:         ua,
    snapshot:           { contenido, proveedor: resuelto.proveedor, datosFirma: resuelto.datosFirma },
  }).select('id').single()

  if (error || !filaNueva) {
    // 23505 = ya hay una firma VIGENTE de este documento-versión (índice parcial).
    if (error?.code === '23505') return { ok: false, error: 'Este documento ya está firmado.' }
    return { ok: false, error: 'No se pudo registrar la firma.' }
  }

  await logActividad(db, {
    user_email: session.email,
    entity: 'firma',
    entity_id: session.client_id,
    action: 'firmar_documento',
    description: `Firmó el documento «${contenido.titulo}» (${contenido.version}).`,
  })

  revalidatePath('/portal/perfil')
  revalidatePath('/portal/dashboard')

  return {
    ok: true,
    firma: {
      id: filaNueva.id as number,
      version: contenido.version, docHash, firmadoAt,
      firmadoPorNombre: nombre, firmadoPorEmail: session.email,
    },
    contenido,
    proveedor: resuelto.proveedor,
  }
}

// ── Guardar el PDF firmado (subida al bucket privado) ───────────────────────
// El PDF se genera en el navegador (jsPDF es cliente-only) y se sube aquí, tras
// firmar. Es best-effort: si falla, la firma sigue siendo válida (el registro es
// la fila, no el PDF) y `pdf_path` queda null.
export async function subirPdfFirma(formData: FormData): Promise<{ ok: boolean; error?: string }> {
  const session = await getPortalSession()
  if (!session) return { ok: false, error: 'Sesión inválida.' }
  if (session.rol !== 'admin_empresa') return { ok: false, error: 'Sin permiso.' }

  const firmaId = Number(formData.get('firmaId'))
  const file = formData.get('pdf')
  if (!Number.isFinite(firmaId) || firmaId <= 0) return { ok: false, error: 'Firma no válida.' }
  if (!(file instanceof File)) return { ok: false, error: 'PDF ausente.' }
  if (file.type !== 'application/pdf') return { ok: false, error: 'El archivo debe ser PDF.' }
  if (file.size > 10 * 1024 * 1024) return { ok: false, error: 'El PDF no puede superar los 10 MB.' }

  const db = createAdminClient()
  // Blob, no Buffer: en el runtime serverless de Vercel un Buffer corrompe la subida.
  const buffer = Buffer.from(await file.arrayBuffer())
  const blob = new Blob([new Uint8Array(buffer)], { type: 'application/pdf' })
  // Ruta por ID de firma: cada firma (incluidas las caducadas) conserva su propio
  // PDF como prueba de lo que se firmó entonces.
  const path = `${session.client_id}/${firmaId}.pdf`
  const { error: upErr } = await db.storage.from(BUCKET).upload(path, blob, {
    contentType: 'application/pdf', upsert: true,
  })
  if (upErr) return { ok: false, error: upErr.message }

  const { error } = await db.from('firmas_documentos')
    .update({ pdf_path: path })
    .eq('id', firmaId)
    .eq('client_id', session.client_id)
  if (error) return { ok: false, error: 'No se pudo guardar la referencia del PDF.' }

  revalidatePath('/portal/perfil')
  return { ok: true }
}
