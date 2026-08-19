#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// Auditoría de gating de las server actions del portal (candado comercial).
//
// Marca toda función 'use server' que ESCRIBE en BD (insert/update/delete/upsert/
// rpc) y NO tiene candado de acceso. Un candado solo de `solo_lectura` NO cuenta:
// bloquea al usuario de solo-lectura pero deja pasar a un cliente que no contrató
// el módulo. Cuenta como candado: puedeEditarModulo / puedeEditarAlgunModulo /
// tieneModulo / require*Modulo / requireAddonIa / (rol !== 'admin_empresa').
//
// Objetivo: que NINGÚN módulo o funcionalidad —presente o futura— pueda mutar sin
// comprobar que el cliente lo contrató. Si nace una acción nueva sin candado, este
// script falla (exit 1) y hay que gatearla o justificarla en ALLOWLIST.
//
// Uso:  node scripts/audit-gating.mjs   ·   npm run audit:gating
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const DIR = 'src/app/actions/portal'

// Acciones que a propósito NO llevan candado de módulo. Cada una, con su motivo.
// Añadir aquí es una decisión CONSCIENTE (público, self-service o excepción de
// negocio), no una vía para saltarse el gating.
const ALLOWLIST = {
  // Flujo público sin login (cliente final reservando). Sin sesión → el candado
  // NO es por usuario sino por TENANT: crear*Publica valida modulos_activos del
  // negocio (dueño del slug/client_id) e insert solo si tiene el módulo; los
  // loaders públicos hacen lo mismo → la página hace notFound(). Protección extra:
  // rate-limit + honeypot. cancelar*Publica gestiona una reserva YA existente por
  // token (el cliente debe poder cancelar aunque el negocio deje el módulo).
  'reservas.ts': ['crearReservaPublica', 'cancelarReservaPublica', 'obtenerSlotsAforo', 'obtenerProximoDiaAforo', 'obtenerDiasDisponiblesAforo'],
  'citas.ts':    ['crearCitaPublica', 'obtenerSlotsCita', 'obtenerDiasDisponiblesCita'],
  // Excepción de negocio: un usuario de solo-lectura SÍ puede actualizar tasas.
  'monedas.ts':  ['actualizarTasasAuto'],
  // Self-service: cada usuario edita su propio perfil.
  'perfil.ts':   ['actualizarMiPerfil'],
  // Cualquier usuario con sesión puede contactar a soporte. `pedirReactivacion` es
  // además el ÚNICO botón de un cliente bloqueado: exigirle un módulo contratado sería
  // pedirle lo que acaba de perder para poder pedir que se lo devuelvan.
  'soporte.ts':  ['enviarMensajeSoporte', 'registrarInteresModulo', 'pedirReactivacion'],
  // Plantillas de MAPEO del importador: no son datos del cliente, son notas del
  // equipo sobre cómo se lee el export de un software de origen (tabla global,
  // sin client_id). El candado real es más estricto que un módulo: `resolverCtx()`
  // exige `session.imp`, o sea modo configuración (admin impersonando). Las
  // acciones que SÍ escriben datos del cliente (crear/validar/aplicar/deshacer
  // lote) llevan además `puedeEditarAlgunModulo` de la entidad destino.
  'importar.ts': ['guardarPlantillaImport', 'eliminarPlantillaImport'],
  // LECTURA pura que el detector marca por el `.rpc(`: `caja_pendientes_contabilizar` es
  // una función `stable` que solo agrega (qué ventas del TPV no han llegado a los libros).
  // Es un anti-join, y por eso vive en la base y no en el código: hacerlo desde Next
  // obligaría a traerse todos los tickets del cliente, o a acotar por fecha y esconder
  // dinero viejo. El candado lo pone la página con `requireModulo('caja')`, como el resto
  // de lecturas del portal. Lo que SÍ escribe (cerrarYContabilizar, reintentarContabilizar)
  // lleva `puedeEditarModulo('caja')`.
  'caja.ts':     ['listarSinContabilizar'],
}

const WRITE = /\.(insert|update|delete|upsert)\s*\(|\.rpc\s*\(/
// Guards propios de notificaciones.ts (plataforma, no se contrata; la bandeja es
// del negocio). Cuentan como candado porque filtran por rol/categoría antes de
// tocar la fila, no son una excepción:
//   · `sesionAdmin()`   → solo admin_empresa (Preferencias).
//   · `sesionBandeja()` → admin_empresa ve todo; un `usuario` solo las categorías
//     operativas de sus módulos (decisión 4), y toda mutación acota además con
//     `.in('categoria', categorias)` para que no toque lo que no ve.
// `requireImportarEntidad` / `puedeImportar` son el candado del importador de
// autoservicio (importar-cliente.ts): SIEMPRE intersectan el módulo contratado del
// tenant con el interruptor por usuario, así que cuentan como candado de módulo.
const GATE  = /puedeEditarModulo\s*\(|puedeEditarAlgunModulo\s*\(|tieneModulo\s*\(|require(Modulo|AlgunModulo|AccesoModulo|ImportarEntidad)\s*\(|puedeImportar\s*\(|requireAddonIa\s*\(|rol\s*!==\s*'admin_empresa'|sesion(Admin|Bandeja)\s*\(/

const files = readdirSync(DIR).filter(f => f.endsWith('.ts') && f !== 'auth.ts')
const holes = []

for (const file of files) {
  const src = readFileSync(join(DIR, file), 'utf8')
  // Solo ficheros 'use server': sus exports son server actions invocables desde el
  // navegador. Los helpers internos (sin 'use server') se gatean en quien los llama.
  if (!/^\s*['"]use server['"]/m.test(src)) continue

  const allow = new Set(ALLOWLIST[file] ?? [])
  const re = /export\s+async\s+function\s+([a-zA-Z0-9_]+)/g
  const marks = []
  let m
  while ((m = re.exec(src)) !== null) marks.push({ name: m[1], start: m.index })
  for (let i = 0; i < marks.length; i++) {
    const start = marks[i].start
    const end = i + 1 < marks.length ? marks[i + 1].start : src.length
    const body = src.slice(start, end)
    if (!WRITE.test(body)) continue
    if (GATE.test(body)) continue
    if (allow.has(marks[i].name)) continue
    holes.push({ file, fn: marks[i].name, soloLectura: /session\.solo_lectura/.test(body) })
  }
}

if (holes.length === 0) {
  console.log('✓ Gating OK: toda mutación del portal tiene candado de módulo/rol (o está en ALLOWLIST justificada).')
  process.exit(0)
}

console.log(`✗ ${holes.length} mutación(es) SIN candado de módulo/rol:\n`)
for (const h of holes) {
  console.log(`  ${h.file} → ${h.fn}()  ${h.soloLectura ? '(solo bloquea solo_lectura)' : '(SIN NINGÚN candado)'}`)
}
console.log('\nGatea con puedeEditarModulo(<modulo>), o si es pública/self-service justifícala en ALLOWLIST.')
process.exit(1)
