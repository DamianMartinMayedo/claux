#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// Auditoría del SISTEMA DE TABLAS (`skills/ui/SKILL.md` §tablas).
//
// Una tabla nueva se escribe copiando la de al lado, y lo que se copia es lo que
// se ve en el escritorio. Lo que no se ve —la etiqueta que hace legible la fila en
// un móvil, el menú que evita seis iconos amontonados, el orden por columna— es lo
// primero que se cae. Estas tres reglas son las que no se notan hasta que molestan:
//
//   1. `data-label` en cada `<td>` del cuerpo. Bajo 640px la tabla se vuelve
//      tarjetas «etiqueta: valor»; sin el atributo, la tarjeta sale muda. En Cuba
//      el móvil no es el caso raro: es el caso.
//   2. `RowActions` cuando una fila tiene 2+ acciones, en vez de una hilera de
//      iconos que en móvil se pisan.
//   3. `ThOrden` en las tablas de LISTADO — las que traen selección, paginación o
//      barra de filtros. Se reconoce el listado por esas señales, no por el nombre
//      del fichero: una tabla de líneas de una factura no ordena por columna.
//
// Uso:  node scripts/audit-tablas.mjs   ·   npm run audit:tablas
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const RAICES = ['src/app', 'src/components']

// Tablas que se saltan una regla a propósito, con el motivo. Heredadas del día en
// que se escribió el centinela: lo que entra nuevo cumple, no se añade aquí.
const ALLOWLIST = {
  // El ORDEN ES EL DATO: estas dos tablas se reordenan a mano (subir/bajar) y esa
  // secuencia es lo que se guarda. Una columna ordenable pelearía con ella.
  'src/app/admin/(protected)/ventas/propuestas/capturas/CapturasView.tsx': ['orden'],
  'src/app/portal/(app)/catalogo/CatalogoEditor.tsx': ['orden'],
  // Deuda conocida del PORTAL, anterior a este centinela: hileras de iconos que
  // deberían ser un menú. No se tocan desde la revisión del admin para no mezclar
  // dos barridos; quedan anotadas para que se vean, no escondidas.
  'src/app/portal/(app)/rrhh/[empleado_id]/EmpleadoDetalleView.tsx': ['acciones'],
  'src/app/portal/(app)/usuarios/UsuariosView.tsx': ['acciones'],
  'src/app/portal/(app)/tesoreria/TesoreriaView.tsx': ['acciones'],
}

/** Todos los .tsx con `<table`, menos las páginas públicas (diseño propio). */
function ficheros(dir, out = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    if (statSync(p).isDirectory()) ficheros(p, out)
    // La landing, la propuesta pública y el TPV llevan su propia paleta y su propia
    // tabla: no beben del sistema del portal, así que no se les mide con su regla.
    else if (e.endsWith('.tsx') && !/\(public\)|\(landing\)/.test(p) && readFileSync(p, 'utf8').includes('<table')) out.push(p)
  }
  return out
}

const fallos = []
const salta = (f, regla) => (ALLOWLIST[f] ?? []).includes(regla)

for (const f of RAICES.flatMap(r => ficheros(r))) {
  const src = readFileSync(f, 'utf8')
  const linea = (i) => src.slice(0, i).split('\n').length

  // ── 1. data-label. El pie (`<tfoot>`) fuera: la fila de totales no es un dato de
  //    la lista, es su suma, y en móvil se lee entera sin etiqueta que la nombre.
  if (!salta(f, 'label')) {
    const cuerpo = src.replace(/<tfoot[\s\S]*?<\/tfoot>/g, '')
    for (const m of cuerpo.matchAll(/<td\b[^>]*>/g)) {
      const td = m[0]
      // `col-check` (la casilla) y `col-actions` (el menú) no llevan etiqueta: no
      // son datos. `colSpan` es una fila que ocupa la tabla entera (vacíos, avisos).
      if (/data-label|col-actions|col-check|colSpan|drag/i.test(td)) continue
      fallos.push({ f, l: linea(m.index), regla: 'label', que: `<td> sin data-label: ${td.replace(/\s+/g, ' ').slice(0, 60)}` })
    }
  }

  // ── 2. RowActions con 2+ acciones.
  if (!salta(f, 'acciones')) {
    for (const m of src.matchAll(/<td className="col-actions"[^>]*>/g)) {
      const cuerpo = src.slice(m.index, src.indexOf('</td>', m.index))
      if (/RowActions/.test(cuerpo)) continue
      const controles = (cuerpo.match(/<button\b[\s\S]*?>|<Link\b[\s\S]*?>/g) ?? []).filter(c =>
        // Un formulario de edición en la propia fila (Guardar / Cancelar) no son
        // acciones de fila, y un desplegable de detalle tampoco: son la fila misma.
        !/type="submit"|form=|aria-expanded/.test(c))
      if (controles.length >= 2) {
        fallos.push({ f, l: linea(m.index), regla: 'acciones', que: `${controles.length} acciones sueltas en col-actions, sin RowActions` })
      }
    }
  }

  // ── 3. ThOrden en listados. La señal de «listado» es funcional: si la tabla trae
  //    selección, paginación o barra de filtros, es una lista que se explora.
  if (!salta(f, 'orden') && !src.includes('ThOrden')) {
    const senal = ['useRowSelection', 'TablePagination', "from '@/lib/filtros'", '<Filtros'].find(s => src.includes(s))
    if (senal) fallos.push({ f, l: linea(src.indexOf('<table')), regla: 'orden', que: `tabla de listado (${senal}) sin columnas ordenables (ThOrden)` })
  }
}

if (fallos.length === 0) {
  console.log('✓ Tablas OK: data-label en el cuerpo, RowActions con 2+ acciones, ThOrden en los listados.')
  process.exit(0)
}

console.log(`✗ ${fallos.length} desvío(s) del sistema de tablas:\n`)
for (const x of fallos) console.log(`  ${x.f}:${x.l}\n    [${x.regla}] ${x.que}`)
console.log('\nEl contrato está en skills/ui/SKILL.md (§tablas). Si el desvío es deliberado, justifícalo en el ALLOWLIST.')
process.exit(1)
