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
  // Flujo público sin login (cliente final reservando). Protección propia:
  // rate-limit + honeypot. OJO: la página pública NO valida hoy el módulo del
  // tenant (ver TODO en AGENTS.md) — hardening pendiente en otro eje.
  'reservas.ts': ['crearReservaPublica', 'cancelarReservaPublica', 'obtenerSlotsAforo', 'obtenerProximoDiaAforo', 'obtenerDiasDisponiblesAforo'],
  'citas.ts':    ['crearCitaPublica', 'obtenerSlotsCita', 'obtenerDiasDisponiblesCita'],
  // Excepción de negocio: un usuario de solo-lectura SÍ puede actualizar tasas.
  'monedas.ts':  ['actualizarTasasAuto'],
  // Self-service: cada usuario edita su propio perfil.
  'perfil.ts':   ['actualizarMiPerfil'],
  // Cualquier usuario con sesión puede contactar a soporte.
  'soporte.ts':  ['enviarMensajeSoporte'],
}

const WRITE = /\.(insert|update|delete|upsert)\s*\(|\.rpc\s*\(/
const GATE  = /puedeEditarModulo\s*\(|puedeEditarAlgunModulo\s*\(|tieneModulo\s*\(|require(Modulo|AlgunModulo|AccesoModulo)\s*\(|requireAddonIa\s*\(|rol\s*!==\s*'admin_empresa'/

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
