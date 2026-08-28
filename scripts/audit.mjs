#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// Los seis centinelas de una vez.
//
// POR QUÉ EXISTE. Hasta ahora eran comandos sueltos que había que acordarse de
// ejecutar, y una regla que hay que recordar no es una regla: es una nota. Esto es
// lo que se corre antes de desplegar (`docs/OPERACION.md`).
//
// Corren EN PARALELO y con la salida guardada, para imprimirlas siempre en el
// mismo orden: seis salidas entrelazadas no se leen. Si uno falla, falla el
// conjunto — pero todos llegan a ejecutarse, porque enterarte de los seis
// problemas de una vez es media hora menos que enterarte de uno por vuelta.
//
// Uso:  npm run audit
// ─────────────────────────────────────────────────────────────────────────────

import { execFile } from 'node:child_process'

const CENTINELAS = [
  ['gating',   'scripts/audit-gating.mjs',   'candado comercial de las mutaciones del portal'],
  ['columnas', 'scripts/audit-columnas.mjs', 'columnas que el código pide y la BD no tiene'],
  ['filtros',  'scripts/audit-filtros.mjs',  'listados que recortan o descargas que mienten'],
  ['limites',  'scripts/audit-limites.mjs',  'topes de nivel: declaración y aplicación'],
  ['nivel',    'scripts/audit-nivel.mjs',    'claves de módulo y precios del catálogo'],
  ['precios',  'scripts/audit-precios.mjs',  'importes de CLAUX cableados en el código'],
]

const correr = (script) => new Promise(listo => {
  execFile('node', [script], { maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
    listo({ ok: !err, salida: (stdout + stderr).trimEnd() })
  })
})

const resultados = await Promise.all(CENTINELAS.map(([, script]) => correr(script)))

let fallos = 0
for (let i = 0; i < CENTINELAS.length; i++) {
  const [nombre, , que] = CENTINELAS[i]
  const r = resultados[i]
  if (!r.ok) fallos++
  console.log(`\n── audit:${nombre} — ${que}`)
  console.log(r.salida || '(sin salida)')
}

console.log(`\n${fallos === 0
  ? `✓ Los ${CENTINELAS.length} centinelas en verde.`
  : `✗ ${fallos} de ${CENTINELAS.length} centinelas en rojo.`}`)
process.exit(fallos === 0 ? 0 : 1)
