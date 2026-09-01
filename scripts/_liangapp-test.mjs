// Verificación de los lectores de LiangApp (fase 1 del plan) contra archivos
// reales. No toca la BD: lee del disco y comprueba lo que el plan da por hecho.
//
//   node scripts/_liangapp-test.mjs [carpeta]
//
// Por defecto ~/Downloads, donde están los diez archivos de AUGE 2025. De los
// .xlsx que encuentre, ignora en silencio los que no sean de LiangApp.
//
// Comprueba:
//   1. que cada archivo se reconoce solo (tipo, cuenta, empresa, período)
//   2. que cada mayor cuadra AL CÉNTIMO con su línea del estado oficial
//   3. que tras corregir las fechas no queda ningún salto atrás en el tiempo
//   4. que la utilidad reconstruida coincide con la del estado
//   5. la firma del fallo de origen: ninguna fecha en texto con día ≤ 12
//   6. (fase 2) el reparto: subidos los diez de golpe, qué lote sale de cada
//      cuenta, qué se aparta como factura y si el cuadre sigue en pie
//   7. (fase 4) la clasificación propuesta: que la cabeza medida del 822 salga
//      bien, que toda propuesta exista en el catálogo y que ninguna fila se
//      quede sin grupo
//   8. (fase 5) el cuadre: sobre un mayor de laboratorio, quitarle una línea
//      tiene que romperlo
//   9. (fase 6) el candado de aplicación (sin estado no se aplica, apartar una
//      cuenta la saca del cuadre), el orden de los lotes y los datos con los
//      que se rellena la plantilla de facturas
//
// Conviene correrlo también con `TZ=UTC` delante, que es como corre Vercel: la
// corrección de fechas tiene que dar exactamente lo mismo.
import { readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'
import { createJiti } from 'jiti'

// jiti no lee los `paths` del tsconfig, y el perfil importa el catálogo por
// alias (`@/lib/catalogo/catalogo`). Sin esto el script muere al cargar reglas.ts.
const raiz = join(dirname(fileURLToPath(import.meta.url)), '..')
const jiti = createJiti(import.meta.url, { alias: { '@': join(raiz, 'src') } })
const { leerHojas }      = await jiti.import('../src/lib/importador/archivo.ts')
const { detectarArchivo }= await jiti.import('../src/lib/importador/origenes/liangapp/detectar.ts')
const { leerMayor }      = await jiti.import('../src/lib/importador/origenes/liangapp/mayor.ts')
const { leerEstado, importeOficial } = await jiti.import('../src/lib/importador/origenes/liangapp/estado.ts')
const { leerMigracion, resumenCuadre, ORDEN } = await jiti.import('../src/lib/importador/origenes/liangapp/migracion.ts')
const { COL_ORDEN }      = await jiti.import('../src/lib/importador/origenes/liangapp/rutas.ts')
const { nombresDe, esEtiquetaContable } = await jiti.import('../src/lib/importador/origenes/liangapp/reglas.ts')
const { construirXlsxBase64, texto: celdaTexto, numero: celdaNumero } = await jiti.import('../src/lib/exportar/excel.ts')

const carpeta = process.argv[2] ?? join(homedir(), 'Downloads')
const eur = n => n.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
let fallos = 0
const mal = m => { console.log('  ✗', m); fallos++ }

const mayores = []
const subidos = []          // lo que el operador arrastraría al asistente, tal cual
let estado = null
let textoConDiaBajo = 0
let ajenos = 0

console.log(`Carpeta: ${carpeta}`)
console.log(`Zona horaria del proceso: ${Intl.DateTimeFormat().resolvedOptions().timeZone}\n`)

for (const f of readdirSync(carpeta).filter(n => n.endsWith('.xlsx')).sort()) {
  const base64 = readFileSync(join(carpeta, f)).toString('base64')
  subidos.push({ nombre: f, base64 })
  let hojas
  try { hojas = await leerHojas(base64) } catch { continue }
  const rep = detectarArchivo(hojas)
  if (!rep) { ajenos++; continue }         // no es de LiangApp: ni se menciona

  if (rep.tipo === 'estado') {
    estado = leerEstado(rep)
    console.log(`ESTADO  «${f}» → ${estado.empresa} · ${estado.periodo} · ${estado.filas.length} líneas · utilidad ${eur(estado.utilidadAntesDeImpuesto ?? 0)}`)
    estado.avisos.forEach(mal)
    continue
  }

  const m = leerMayor(rep)
  mayores.push(m)
  console.log(`MAYOR   «${f}» → cuenta ${m.cuenta} «${m.nombreCuenta}» · ${m.lineas.length} líneas · ${m.fechas.corregidas} fechas corregidas · ${m.cierre.lineas} de cierre excluidas`)
  m.avisos.forEach(mal)

  // 3. ordenado por nº de asiento, el tiempo no puede ir hacia atrás
  const saltos = m.lineas.reduce((n, l, i) => i && l.fecha < m.lineas[i - 1].fecha ? n + 1 : n, 0)
  if (saltos) mal(`cuenta ${m.cuenta}: ${saltos} salto(s) hacia atrás en el tiempo tras corregir`)

  // 5. la firma del fallo: si la celda vino en texto, su día es > 12
  for (const fila of rep.hoja.data.slice(rep.iCabecera + 1)) {
    const c = fila?.[0]
    if (c instanceof Date) continue
    const t = /^(\d{1,2})\/\d{1,2}\/\d{4}$/.exec(String(c ?? '').trim())
    if (t && +t[1] <= 12) textoConDiaBajo++
  }
}

console.log(`\n(${ajenos} .xlsx de la carpeta NO se han reconocido como de LiangApp: nuestras plantillas y exportes propios deben caer aquí)`)

if (!estado) {
  console.log('\n✗ No se ha encontrado el estado de rendimiento financiero: sin él no hay cuadre.')
  process.exit(1)
}

console.log('\ncuenta | leído del mayor | oficial del estado')
let ingresos = 0, gastos = 0
for (const m of mayores.sort((a, b) => a.cuenta - b.cuenta)) {
  const of_ = importeOficial(estado, m.cuenta)
  const ok = of_ !== null && Math.abs(of_ - m.total) < 0.005
  console.log(`  ${m.cuenta}  | ${eur(m.total).padStart(15)} | ${of_ === null ? '— (no está en el estado)' : eur(of_).padStart(15)}  ${ok ? '✓' : '✗'}`)
  if (!ok) mal(`cuenta ${m.cuenta}: el mayor suma ${eur(m.total)} y el estado dice ${of_ === null ? 'nada' : eur(of_)}`)
  if (m.cuenta >= 900) ingresos += m.total; else gastos += m.total
}

// 4. la utilidad reconstruida (ONAT: 800-899 gasto, 900-999 ingreso)
const utilidad = Math.round((ingresos - gastos) * 100) / 100
console.log(`\ningresos ${eur(ingresos)} − gastos ${eur(gastos)} = ${eur(utilidad)}`)
console.log(`utilidad antes del impuesto (oficial):  ${eur(estado.utilidadAntesDeImpuesto ?? 0)}`)
if (Math.abs((estado.utilidadAntesDeImpuesto ?? NaN) - utilidad) >= 0.005) mal('la utilidad reconstruida no coincide con la oficial')

console.log(`\nfechas en TEXTO con día ≤ 12: ${textoConDiaBajo} (tiene que ser 0: con día ≤ 12 LiangApp escribe la celda como Fecha, y esas son las que van cambiadas)`)
if (textoConDiaBajo) mal('el mecanismo del fallo no es el que creemos: revisa la regla antes de importar nada')

const conEjemplos = mayores.find(m => m.fechas.ejemplos.length)
if (conEjemplos) {
  console.log(`\nmuestra de correcciones (cuenta ${conEjemplos.cuenta}) — esto es lo que verá el operador al validar:`)
  conEjemplos.fechas.ejemplos.forEach(e => console.log(`  fila ${e.fila} · ${e.referencia} · el archivo dice ${e.leida} → ${e.corregida}`))
}

// ── FASE 2 · el reparto ───────────────────────────────────────────────────────
// Lo mismo que hará el asistente cuando el operador suelte la carpeta entera:
// una sola llamada con TODOS los archivos, los ajenos incluidos.
const mig = await leerMigracion(subidos)

console.log('\n── reparto (fase 2) ──')
console.log(`empresa «${mig.empresa}» · período ${mig.periodo}`)
mig.errores.forEach(mal)
mig.avisos.forEach(a => console.log(`  · ${a}`))

console.log('\narchivo → destino')
for (const fi of mig.fichas.filter(x => x.tipo === 'mayor')) {
  const destino = fi.entidad ? `→ ${fi.entidad}` : `— no se importa (${fi.motivo ?? 'sin motivo'})`
  const parte = fi.facturas ? ` · ${eur(fi.facturas)} apartado a facturas` : ''
  console.log(`  ${String(fi.cuenta).padEnd(4)} ${fi.etiqueta.padEnd(38)} ${String(fi.lineas).padStart(4)} líneas ${destino}${parte}`)
}
for (const fi of mig.fichas.filter(x => x.tipo === 'estado')) console.log(`  ---  ${fi.etiqueta}`)

console.log('\nlotes que se crearían, en orden:')
for (const l of mig.lotes) {
  const suma = l.filas.reduce((s, f) => s + Number(f.monto), 0)
  console.log(`  ${l.entidad.padEnd(7)} ${String(l.filas.length).padStart(4)} filas · ${eur(suma)} · columnas: ${l.cabeceras.join(', ')}`)
  // Las filas del lote tienen que traer TODAS las columnas del mapeo, o el motor
  // leería un default donde el archivo sí decía algo.
  const incompleta = l.filas.find(f => l.cabeceras.some(c => !(c in f)))
  if (incompleta) mal(`lote ${l.entidad}: hay filas sin todas las columnas`)
  // La moneda va vacía a propósito: la pone el default del lote, sacado de las
  // monedas del cliente. Si alguna trae una escrita, alguien cableó «CUP».
  if (l.filas.some(f => f.moneda)) mal(`lote ${l.entidad}: alguna fila trae moneda escrita; tiene que mandar el default del cliente`)
  if (l.filas.some(f => f.pagado !== 'Sí')) mal(`lote ${l.entidad}: el histórico entra pagado`)
}

// Nada se pierde por el camino: cada línea de un mayor enrutado acaba en un lote
// o en la lista de facturas.
const enrutadas = mig.fichas.filter(f => f.tipo === 'mayor' && f.entidad).reduce((s, f) => s + f.lineas, 0)
const enLotes   = mig.lotes.reduce((s, l) => s + l.filas.length, 0)
console.log(`\nlíneas enrutadas ${enrutadas} = ${enLotes} en lotes + ${mig.facturas.length} facturas detectadas`)
if (enrutadas !== enLotes + mig.facturas.length) mal('se han perdido líneas por el camino')

for (const c of mig.cuadre) {
  if (!c.cuadra) mal(`cuenta ${c.cuenta}: el reparto no cuadra con el estado (${eur(c.diferencia ?? 0)} de diferencia)`)
  if (Math.abs(c.importado + c.aFacturas - c.leido) >= 0.005) mal(`cuenta ${c.cuenta}: importado + facturas ≠ leído`)
}
const venta = mig.cuadre.find(c => c.aFacturas > 0)
if (venta) console.log(`cuenta ${venta.cuenta}: de ${eur(venta.leido)} leídos, ${eur(venta.aFacturas)} son facturas y ${eur(venta.importado)} entran como cobros`)
if (!mig.utilidad.completa) mal('la utilidad no se ha podido reconstruir: falta algún mayor')
if (!mig.utilidad.cuadra)   mal(`la utilidad reconstruida (${eur(mig.utilidad.reconstruida)}) no coincide con la oficial`)
mig.sinArchivo.forEach(f => console.log(`  · sin mayor subido: ${f.concepto} (${eur(f.importe)})`))

// ── FASE 4 · la clasificación propuesta ───────────────────────────────────────
console.log('\n── clasificación propuesta (fase 4) ──')

// La heurística que separa la etiqueta del contador de la referencia del banco.
for (const [d, esperado] of [
  ['Nómina', true], ['Depreciación', true], ['Impuesto venta', true],
  ['MM502GCV22987', false], ['TX1739157523852474', false], ['41012511963505', false],
]) {
  if (esEtiquetaContable(d) !== esperado) mal(`«${d}»: esEtiquetaContable dice ${!esperado}`)
}

const loteGastos = mig.lotes.find(l => l.entidad === 'gastos')
const sumaGastos = loteGastos.filas.reduce((s, f) => s + Number(f.monto), 0)
let clasificado = 0
console.log('grupo                     líneas         importe  propuesta')
for (const g of mig.grupos) {
  const n = g.propuesta ? nombresDe(g.propuesta) : null
  if (g.propuesta && !n) mal(`grupo ${g.grupo}: propone «${g.propuesta}», que no está en el catálogo`)
  if (n) clasificado += g.importe
  console.log(`  ${g.grupo.padEnd(22)} ${String(g.lineas).padStart(4)} ${eur(g.importe).padStart(15)}  ${n ? `${n.categoria} · ${n.subcategoria}` : '— sin proponer —'}`)
}
console.log(`\nclasificado por el perfil: ${eur(clasificado)} de ${eur(sumaGastos)} (${(clasificado / sumaGastos * 100).toFixed(1)} %)`)

// La cabeza medida en §2.4 del plan: es lo que el contador escribió a mano en
// `Documento primario`, así que no puede fallar.
for (const [clave, mínimo, catalogo] of [
  ['regla:nomina', 24, 'salarios'],
  ['regla:depreciacion', 12, 'dep_equipos'],
  ['regla:parqueo', 11, 'gas_parqueo'],
  ['regla:prestaciones', 6, 'gas_estimulacion'],
  ['regla:amortizacion', 4, 'dep_intangibles'],
  ['cuenta:855', 24, 'contribucion_ss_empresa'],
  ['cuenta:805', 12, 'gas_imp_servicios'],
]) {
  const g = mig.grupos.find(x => x.grupo === clave)
  if (!g) { mal(`falta el grupo ${clave}`); continue }
  if (g.lineas < mínimo)      mal(`${clave}: ${g.lineas} líneas, se midieron ${mínimo}`)
  if (g.propuesta !== catalogo) mal(`${clave}: propone «${g.propuesta}» y debería ser «${catalogo}»`)
}

// Ni una fila de gasto sin grupo, y la categoría escrita tiene que ser la del
// grupo: si no, el lote diría una cosa y el asistente otra.
const porGrupo = new Map(mig.grupos.map(g => [g.grupo, g]))
for (const f of loteGastos.filas) {
  const g = porGrupo.get(f._grupo)
  if (!g) { mal(`fila sin grupo reconocible (${f._grupo || 'vacío'})`); break }
  const n = g.propuesta ? nombresDe(g.propuesta) : null
  if ((f.categoria || '') !== (n?.categoria ?? '') || (f.subcategoria || '') !== (n?.subcategoria ?? '')) {
    mal(`fila del grupo ${f._grupo}: escribe «${f.categoria} · ${f.subcategoria}» y el grupo propone «${n?.categoria ?? ''} · ${n?.subcategoria ?? ''}»`)
    break
  }
}
// Y el perfil NO inventa raíces: lo que va en `categoria` es siempre una raíz
// del catálogo (trampa 5 del plan).
const raices = new Set(mig.grupos.filter(g => g.propuesta).map(g => nombresDe(g.propuesta).categoria))
console.log(`raíces del catálogo usadas: ${[...raices].join(' · ')}`)

// ── FASE 5 · el cuadre caza una línea que falta ───────────────────────────────
// Sobre un mayor de laboratorio, que es la única forma de quitar una línea «a
// mano» sin tocar los archivos del cliente.
console.log('\n── cuadre (fase 5) ──')

const LAB = [
  ['15/03/2025', 'NC00000001', 'Comisión Bancaria', 'Gasto por comisión bancaria', 1200],
  ['20/04/2025', 'NC00000002', 'Comisión mlc',      'Comisión solicitud EC MLC',    800],
  ['25/05/2025', 'NC00000003', 'Contribución Desarrollo Local', 'Contribución Desarrollo Local', 5000],
]
const TOTAL_LAB = LAB.reduce((s, l) => s + l[4], 0)

async function mayorLab(lineas) {
  const base64 = await construirXlsxBase64([{
    nombre: 'Libro Mayor',
    filas: [
      [celdaTexto('Empresa:LABORATORIO SRL')],
      [celdaTexto('Período:01/01/2025 - 31/12/2025 (acumulado)')],
      [celdaTexto('')],
      [celdaNumero(835), celdaTexto('·'), celdaTexto('Gastos Financieros')],
      ['Fecha', 'Referencia', 'Documento primario', 'Descripción', 'Debe', 'Haber', 'Saldo'].map(t => celdaTexto(t)),
      ...lineas.map(l => [
        celdaTexto(l[0]), celdaTexto(l[1]), celdaTexto(l[2]), celdaTexto(l[3]),
        celdaNumero(l[4]), celdaNumero(0), celdaNumero(l[4]),
      ]),
    ],
  }])
  return { nombre: 'mayor-835.xlsx', base64 }
}

const estadoLab = {
  nombre: 'estado.xlsx',
  base64: await construirXlsxBase64([{
    nombre: 'Estado',
    filas: [
      [celdaTexto('Empresa:LABORATORIO SRL')],
      [celdaTexto('Período:01/01/2025 - 31/12/2025')],
      [celdaTexto('')],
      ['Concepto', 'Fila', 'Importe'].map(t => celdaTexto(t)),
      [celdaTexto('Gastos Financieros (835 - 838)'), celdaNumero(24), celdaNumero(TOTAL_LAB)],
      [celdaTexto('Utilidad o Pérdida antes del Impuesto'), celdaNumero(40), celdaNumero(-TOTAL_LAB)],
    ],
  }]),
}

const completo = await leerMigracion([await mayorLab(LAB), estadoLab])
const cuadreOk = completo.cuadre.find(c => c.cuenta === 835)
console.log(`  entero:      ${completo.cuadre.length} cuenta(s) · 835 ${cuadreOk?.cuadra ? 'cuadra ✓' : 'NO cuadra ✗'}`)
if (!cuadreOk?.cuadra) mal('el mayor de laboratorio completo debería cuadrar contra su estado')
if (!completo.utilidad.cuadra) mal('la utilidad del laboratorio debería cuadrar')

const mutilado = await leerMigracion([await mayorLab(LAB.slice(0, -1)), estadoLab])
const cuadreMal = mutilado.cuadre.find(c => c.cuenta === 835)
console.log(`  sin la 3ª:   835 ${cuadreMal?.cuadra ? 'cuadra ✗ (no debería)' : `descuadra ✓ por ${eur(cuadreMal?.diferencia ?? 0)}`}`)
if (cuadreMal?.cuadra) mal('quitando una línea, el cuadre tiene que romperse: no lo ha cazado')
if (Math.abs((cuadreMal?.diferencia ?? 0) + LAB[2][4]) >= 0.005) mal('la diferencia que informa el cuadre no es la de la línea que falta')

// Y las reglas también funcionan sobre el laboratorio: 835 clasifica por
// descripción, que es la pasada floja.
for (const [clave, catalogo] of [['regla:comisiones', 'comisiones_bancarias'], ['regla:contrib_territorial', 'gas_contrib_territorial']]) {
  const g = completo.grupos.find(x => x.grupo === clave)
  if (!g) mal(`laboratorio: falta el grupo ${clave}`)
  else if (g.propuesta !== catalogo) mal(`laboratorio: ${clave} propone «${g.propuesta}»`)
}

// ── FASE 6 · aplicar, deshacer y la plantilla de facturas ────────────────────
console.log('\n── aplicar y facturas (fase 6) ──')

// El candado de la D2 vive en el servidor y se decide con esto mismo: sin
// estado no se aplica, y una cuenta apartada deja de contar para el cuadre.
// Para apartar hace falta que quede algo dentro: al laboratorio (una sola
// cuenta, la que descuadra) se le añade una cuenta sana de al lado.
const sana = { ...completo.cuadre[0], cuenta: 822, etiqueta: 'Gastos de Operaciones' }
const mixto = [...mutilado.cuadre, sana]
const candado = [
  ['sin estado',        resumenCuadre(completo.cuadre, false),   false],
  ['completo',          resumenCuadre(completo.cuadre, true),    true],
  ['descuadrado',       resumenCuadre(mixto, true),              false],
  ['apartando la 835',  resumenCuadre(mixto, true, [835]),       true],
  ['apartándolo todo',  resumenCuadre(mixto, true, [835, 822]),  false],
]
for (const [que, r, esperado] of candado) {
  console.log(`  ${que.padEnd(18)} ${r.ok ? 'deja aplicar' : 'bloquea'} ${r.ok === esperado ? '✓' : '✗'}`)
  if (r.ok !== esperado) mal(`el candado de aplicación falla con «${que}»`)
}

// Los lotes salen en el orden en que se aplican, y ese orden es el declarado.
const orden = mig.lotes.map(l => l.entidad)
if (orden.join('>') !== ORDEN.filter(e => orden.includes(e)).join('>')) {
  mal(`los lotes no salen en el orden de aplicación (${orden.join(' → ')})`)
}
// Cada fila lleva su posición: apartar una cuenta y volver a meterla no puede
// cambiar el orden del lote.
for (const l of mig.lotes) {
  const ns = l.filas.map(f => Number(f[COL_ORDEN]))
  if (ns.some((n, i) => n !== i)) mal(`lote ${l.entidad}: las posiciones (${COL_ORDEN}) no van de 0 a n-1`)
}
console.log(`  orden de aplicación: ${orden.join(' → ')} · posiciones marcadas ✓`)

// La plantilla de facturas se rellena con esto: número, fecha, importe y el
// rastro del origen para la nota interna.
const numeros = mig.facturas.map(f => f.numero)
const repes = [...new Set(numeros.filter((n, i) => numeros.indexOf(n) !== i))]
console.log(`  plantilla: ${mig.facturas.length} líneas · ${new Set(numeros).size} números distintos` +
            (repes.length ? ` · repetido ${repes.join(', ')}` : ''))
if (!mig.facturas.length) mal('no se ha detectado ninguna factura: la plantilla saldría vacía')
for (const f of mig.facturas) {
  if (!f.numero) mal(`factura sin número (${f.archivo}, fila ${f.fila})`)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f.fecha)) mal(`factura ${f.numero}: la fecha «${f.fecha}» no es una fecha ISO`)
  if (!(f.importe > 0)) mal(`factura ${f.numero}: importe ${f.importe}`)
  if (!f.archivo || !f.fila) mal(`factura ${f.numero}: sin rastro del archivo de origen`)
}

console.log(fallos ? `\n✗ ${fallos} fallo(s).` : '\n✓ Todo cuadra.')
process.exit(fallos ? 1 : 0)
