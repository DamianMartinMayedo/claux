#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// Auditoría de guardas de las server actions del ADMIN.
//
// Marca toda acción exportada de `src/app/actions/**` (menos `portal/`, que ya
// vigila `audit-gating.mjs`) que no pase por una guarda de sesión de admin. No
// distingue lectura de escritura a propósito: una acción del admin ve los datos de
// TODOS los clientes, así que una lectura sin candado filtra tanto como un insert.
//
// POR QUÉ NO VALE UN GREP. Al escribir este centinela, la primera versión ingenua
// dio tres falsos positivos: las once acciones de la bandeja de avisos resuelven la
// sesión por un ayudante local (`contexto()`), y `listarPreferenciasAvisos` lo hace
// con `obtenerContextoAdmin` + comprobación de rol. Ninguna llama a una guarda por
// su nombre. Por eso el script RESUELVE AYUDANTES: si una acción llama a una función
// del mismo fichero que sí tiene guarda, cuenta como guardada (hasta 3 saltos).
//
// Uso:  node scripts/audit-admin-guards.mjs   ·   npm run audit:guards
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const RAIZ = 'src/app/actions'

// Acciones SIN guarda de admin a propósito. Cada una, con su motivo. Añadir aquí
// es una decisión consciente, no una vía para saltarse el candado.
const ALLOWLIST = {
  // Formulario público de la web: lo rellena cualquier visitante, que es el punto.
  // El candado que sí tienen es el de una entrada pública — `rateLimitOk()` por IP
  // y campo trampa `hp` (Fase 6.4 del plan de revisión del admin).
  'diagnostico.ts': ['guardarDiagnostico', 'solicitarContactoDiagnostico'],
  // Salir de la impersonación solo BORRA TU PROPIA cookie de portal y te devuelve a
  // la ficha. Exigir sesión de admin sería exigir lo que estás intentando recuperar.
  'admin/impersonar.ts': ['salirDeImpersonacion'],
}

// Guardas directas. `obtenerContextoAdmin` cuenta porque devuelve null sin sesión y
// quien la usa corta ahí mismo; es la forma que tiene la bandeja de avisos de filtrar
// además POR ROL, que un `require*` a secas no haría.
const GUARDA = /require(Permiso|SuperAdmin|AccesoPagina|ContextoAdmin|Admin)\s*\(|obtenerContextoAdmin\s*\(|adminAutenticado\s*\(/

/** Todos los .ts de admin (`portal/` fuera), con su ruta relativa a RAIZ. */
function ficheros(dir = RAIZ, prefijo = '') {
  const out = []
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    if (statSync(p).isDirectory()) {
      if (e === 'portal') continue
      out.push(...ficheros(p, prefijo + e + '/'))
    } else if (e.endsWith('.ts')) {
      out.push([prefijo + e, p])
    }
  }
  return out
}

/** Trocea un fichero en funciones (exportadas o no) → { nombre, cuerpo, exportada }. */
function funciones(src) {
  const re = /(export\s+)?(?:async\s+)?function\s+([a-zA-Z0-9_]+)/g
  const marcas = []
  let m
  while ((m = re.exec(src)) !== null) {
    marcas.push({ exportada: Boolean(m[1]), nombre: m[2], desde: m.index })
  }
  return marcas.map((mk, i) => ({
    ...mk,
    cuerpo: src.slice(mk.desde, i + 1 < marcas.length ? marcas[i + 1].desde : src.length),
  }))
}

const agujeros = []

for (const [rel, ruta] of ficheros()) {
  const src = readFileSync(ruta, 'utf8')
  // Solo ficheros 'use server': sus exports son invocables desde el navegador. Un
  // módulo `server-only` (como admin/metricas.ts) lo protege quien lo importa.
  if (!/^\s*['"]use server['"]/m.test(src)) continue

  const permitidas = new Set(ALLOWLIST[rel] ?? [])
  const fns = funciones(src)
  const porNombre = new Map(fns.map(f => [f.nombre, f]))

  /** ¿Esta función tiene guarda, propia o por un ayudante del mismo fichero? */
  const guardada = (fn, saltos = 0, vistas = new Set()) => {
    if (!fn || saltos > 3 || vistas.has(fn.nombre)) return false
    if (GUARDA.test(fn.cuerpo)) return true
    vistas.add(fn.nombre)
    for (const otra of fns) {
      if (otra.nombre === fn.nombre) continue
      const llamada = new RegExp(`\\b${otra.nombre}\\s*\\(`)
      if (llamada.test(fn.cuerpo) && guardada(porNombre.get(otra.nombre), saltos + 1, vistas)) return true
    }
    return false
  }

  for (const fn of fns) {
    if (!fn.exportada) continue
    if (permitidas.has(fn.nombre)) continue
    if (guardada(fn)) continue
    agujeros.push({ rel, fn: fn.nombre })
  }
}

if (agujeros.length === 0) {
  console.log('✓ Guardas OK: toda acción del admin pasa por una guarda de sesión (o está en ALLOWLIST justificada).')
  process.exit(0)
}

console.log(`✗ ${agujeros.length} acción(es) del admin SIN guarda de sesión:\n`)
for (const a of agujeros) console.log(`  ${a.rel} → ${a.fn}()`)
console.log('\nPon requirePermiso(<seccion>) / requireSuperAdmin(), o si es pública a propósito justifícala en el ALLOWLIST.')
process.exit(1)
