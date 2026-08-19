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

export interface FirmaInfo {
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
  documentos:  DocumentoEstado[]
  proveedor:   DatosProveedor
  puedeFirmar: boolean            // solo el admin de la empresa firma
  pendientes:  number
}

// ── Construcción del Anexo I (presupuesto) ──────────────────────────────────
const usd = (n: number) => `$${(Number(n) || 0).toFixed(2)}`

const TIPO_LABEL: Record<string, string> = {
  base: 'Módulo', modulo: 'Módulo', funcionalidad: 'Funcionalidad', addon: 'Addon',
}

async function construirAnexoInput(
  db: Db, cid: string, cliente: { modulos_activos: string[]; precio_mensual_usd: number; ciclo: string; tarifa: string },
): Promise<AnexoInput> {
  const descuento = parseInt(await leerSetting('descuento_anual_pct', '10'), 10) || 0
  const ciclo = cliente.ciclo === 'anual' ? 'anual' : 'mensual'
  const periodicidad = ciclo === 'anual' ? 'Anual' : 'Mensual'
  const precioMes = Number(cliente.precio_mensual_usd) || 0

  // Preferimos el presupuesto de instalación aprobado del cliente (snapshot
  // congelado con el coste de configuración). El vínculo lo escribe el alta.
  const { data: presu } = await db
    .from('presupuestos_instalacion')
    .select('id, modulos, cuota_mensual_usd, total_final_usd, tarifa, estado, created_at')
    .eq('client_id', cid)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  // Nombres de los módulos desde el catálogo comercial (una sola fuente).
  const claves = (presu?.modulos?.length ? presu.modulos : cliente.modulos_activos) as string[]
  const { data: catalogo } = await db
    .from('modulos_catalogo')
    .select('clave, nombre, tipo, precio_fundador_usd, precio_estandar_usd, orden')
    .in('clave', claves.length ? claves : ['__none__'])
    .order('orden')
  const filasCat = (catalogo ?? []) as {
    clave: string; nombre: string; tipo: string
    precio_fundador_usd: number | null; precio_estandar_usd: number | null; orden: number
  }[]
  const tarifa = presu?.tarifa ?? cliente.tarifa ?? 'estandar'
  const precioDe = (m: typeof filasCat[number]) =>
    Number((tarifa === 'fundador' ? m.precio_fundador_usd : m.precio_estandar_usd) ?? 0)

  const lineas: LineaAnexo[] = filasCat.map(m => {
    const p = precioDe(m)
    return { concepto: m.nombre, tipo: TIPO_LABEL[m.tipo] ?? 'Módulo', precio: p > 0 ? `${usd(p)}/mes` : 'Incluido' }
  })

  const importePeriodico = ciclo === 'anual'
    ? `${usd(importeCiclo(precioMes, 'anual', descuento))}/año`
    : `${usd(precioMes)}/mes`

  if (presu) {
    const totalInstal = Number(presu.total_final_usd) || 0
    // Importe inicial = primer período + parte de configuración (50% al iniciar,
    // cláusula 6). Se muestra el total de configuración y su reparto en la nota.
    const primerPeriodo = ciclo === 'anual' ? importeCiclo(precioMes, 'anual', descuento) : precioMes
    return {
      version: `presupuesto-${presu.id}`,
      fuente: 'presupuesto',
      lineas,
      periodicidad,
      importePeriodico,
      importeInicial: usd(primerPeriodo + totalInstal * 0.5),
      instalacion: totalInstal > 0
        ? { total: usd(totalInstal), nota: 'La configuración se paga en dos partes: 50% al iniciar y 50% al finalizar (cláusula 6).' }
        : undefined,
    }
  }

  // Fallback: sin presupuesto de instalación enlazado (cliente de prueba o alta
  // manual). El Anexo se autogenera desde los módulos activos, sin coste de
  // configuración. La versión codifica el contenido para que un cambio de
  // módulos/tarifa exija una firma nueva.
  const primerPeriodo = ciclo === 'anual' ? importeCiclo(precioMes, 'anual', descuento) : precioMes
  const version = `modulos-${ciclo}-${[...cliente.modulos_activos].sort().join('+') || 'ninguno'}-${precioMes}`
  return {
    version,
    fuente: 'modulos',
    lineas,
    periodicidad,
    importePeriodico,
    importeInicial: usd(primerPeriodo),
  }
}

async function resolverDocumentos(db: Db, cid: string): Promise<{
  cliente: DatosCliente; proveedor: DatosProveedor; docs: Record<TipoDocumento, DocumentoResuelto>
} | null> {
  const { data: c } = await db
    .from('clients')
    .select('nombre_empresa, nombre_contacto, email_admin, modulos_activos, precio_mensual_usd, ciclo_facturacion, tarifa')
    .eq('client_id', cid)
    .single()
  if (!c) return null

  const cliente: DatosCliente = {
    nombre_empresa:     c.nombre_empresa,
    nombre_responsable: c.nombre_contacto,
    email:              c.email_admin,
  }
  const proveedor = await obtenerDatosProveedor()
  const anexo = await construirAnexoInput(db, cid, {
    modulos_activos: Array.isArray(c.modulos_activos) ? c.modulos_activos : [],
    precio_mensual_usd: c.precio_mensual_usd,
    ciclo: c.ciclo_facturacion ?? 'mensual',
    tarifa: c.tarifa ?? 'estandar',
  })

  return {
    cliente,
    proveedor,
    docs: {
      nda:         construirNda(cliente, proveedor),
      contrato:    construirContrato(cliente, proveedor),
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

  const { data: firmas } = await db
    .from('firmas_documentos')
    .select('tipo, version, doc_hash, firmado_at, firmado_por_nombre, firmado_por_email, pdf_path')
    .eq('client_id', session.client_id)
  const firmaDe = new Map<string, Record<string, unknown>>()
  for (const f of (firmas ?? []) as Record<string, unknown>[]) firmaDe.set(f.tipo as string, f)

  const documentos: DocumentoEstado[] = TIPOS.map(tipo => {
    const contenido = resuelto.docs[tipo]
    const f = firmaDe.get(tipo)
    // Firmado solo si la firma corresponde a la versión vigente del documento:
    // si el presupuesto cambió, la firma vieja no cuenta y vuelve a "pendiente".
    const firmado = !!f && f.version === contenido.version
    return {
      tipo,
      contenido,
      firmado,
      firma: firmado ? {
        version:            f!.version as string,
        doc_hash:           f!.doc_hash as string,
        firmado_at:         f!.firmado_at as string,
        firmado_por_nombre: f!.firmado_por_nombre as string,
        firmado_por_email:  f!.firmado_por_email as string,
        tiene_pdf:          !!f!.pdf_path,
      } : undefined,
    }
  })

  return {
    documentos,
    proveedor: resuelto.proveedor,
    puedeFirmar: session.rol === 'admin_empresa',
    pendientes: documentos.filter(d => !d.firmado).length,
  }
}

// ── Firmar un documento ─────────────────────────────────────────────────────
export interface FirmarResultado {
  ok: boolean
  error?: string
  firma?: {
    version: string; docHash: string; firmadoAt: string
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

  const contenido = resuelto.docs[tipo]
  const docHash = await hashDocumento(contenido)
  const firmadoAt = new Date().toISOString()

  const ip = await clientIp()
  const ua = (await headers()).get('user-agent') ?? ''

  const { error } = await db.from('firmas_documentos').insert({
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
    snapshot:           { contenido, proveedor: resuelto.proveedor },
  })

  if (error) {
    // 23505 = ya firmado este documento-versión: no es un error para el usuario.
    if (error.code === '23505') return { ok: false, error: 'Este documento ya está firmado.' }
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

  const tipo = String(formData.get('tipo') ?? '') as TipoDocumento
  const version = String(formData.get('version') ?? '')
  const file = formData.get('pdf')
  if (!TIPOS.includes(tipo) || !version) return { ok: false, error: 'Datos incompletos.' }
  if (!(file instanceof File)) return { ok: false, error: 'PDF ausente.' }
  if (file.type !== 'application/pdf') return { ok: false, error: 'El archivo debe ser PDF.' }
  if (file.size > 10 * 1024 * 1024) return { ok: false, error: 'El PDF no puede superar los 10 MB.' }

  const db = createAdminClient()
  // Blob, no Buffer: en el runtime serverless de Vercel un Buffer corrompe la subida.
  const buffer = Buffer.from(await file.arrayBuffer())
  const blob = new Blob([new Uint8Array(buffer)], { type: 'application/pdf' })
  const path = `${session.client_id}/${tipo}-${version}.pdf`
  const { error: upErr } = await db.storage.from(BUCKET).upload(path, blob, {
    contentType: 'application/pdf', upsert: true,
  })
  if (upErr) return { ok: false, error: upErr.message }

  const { error } = await db.from('firmas_documentos')
    .update({ pdf_path: path })
    .eq('client_id', session.client_id)
    .eq('tipo', tipo)
    .eq('version', version)
  if (error) return { ok: false, error: 'No se pudo guardar la referencia del PDF.' }

  revalidatePath('/portal/perfil')
  return { ok: true }
}
