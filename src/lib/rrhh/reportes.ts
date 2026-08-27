// ── Agregación de los reportes de personal — lógica PURA, sin I/O ───────────
//
// Vivía entera dentro de `rrhh-reportes/ReportesView.tsx`, en `useMemo`s. Sale
// aquí porque el Excel se genera en SERVIDOR (el escritor de .xlsx es server-only)
// y necesita exactamente las mismas cifras: dejarla en la vista habría obligado a
// reimplementar plantilla, altas, bajas y coste por departamento en el otro lado
// — dos implementaciones del mismo número, que es como el informe de pantalla y
// el archivo acaban discrepando sin que nadie sepa cuál mira.

export interface EmpleadoRrhh {
  empleado_id: string
  empresa_id:  string
  estado:      string
  /** Solo para nombrar al de más antigüedad; el resto del informe no lo usa. */
  nombre?:     string | null
  departamento?: string | null
  /** El puesto. El coste por CARGO responde otra pregunta que el coste por departamento:
   *  «Cocina» no dice cuánto cuesta tener tres cocineros y un friegaplatos. */
  cargo?:      string | null
  fecha_alta?:  string | null
  fecha_baja?:  string | null
}

export interface NominaRrhh {
  empresa_id: string
  estado:     string
  periodo:    string
  moneda:     string
  /** Σ NETOS. Es lo que sale hacia la plantilla, NO lo que cuesta: ver `costeDe`. */
  total:      number
  lineas:     { empleado_id: string; neto: number; devengado: number }[]
}

/**
 * El coste de personal de una nómina es su DEVENGADO, no su neto.
 *
 * Esto estaba mal y se enseñaba mal: se sumaba `nominas.total`, que es Σ netos, así
 * que cada retención REBAJABA el coste que veía el dueño — con 1.200 de devengado y
 * 75 retenidos, este informe decía 1.125. Es el mismo error que la mig. 139 arregló
 * en la contabilidad (allí lo retenido se evaporaba); el P&L quedó bien y este
 * informe se quedó atrás. Una retención no es un ahorro: es el mismo coste con un
 * segundo acreedor.
 */
export function costeDe(n: NominaRrhh): number {
  return n.lineas.reduce((s, l) => s + l.devengado, 0)
}

export interface MontoMoneda { moneda: string; monto: number }

export interface ReportesRrhh {
  plantilla:   number
  altas:       number
  bajas:       number
  costeAnual:  MontoMoneda[]
  costePorMes: { periodo: string; monedas: MontoMoneda[] }[]
  porDepto:    { departamento: string; activos: number; coste: MontoMoneda[] }[]
  porEmpresa:  { empresa_id: string; nombre: string; activos: number; coste: MontoMoneda[] }[]
  /**
   * La DEUDA DE VACACIONES de toda la plantilla: un pasivo real y cuantificado que se
   * derivaba persona a persona (`saldoVacacionesAcumulado`) y no se agregaba en ninguna
   * parte — ni aquí, ni en el dashboard, ni en el dossier. Solo bajo modelo cubano, que
   * es el único que las acumula.
   */
  vacaciones:  {
    /** La deuda VIVA al cierre del año = suma del saldo final, por moneda. */
    total: MontoMoneda[]
    /** El submayor por trabajador: saldo que se abre, se mueve y se cierra, en las dos
     *  unidades. Solo quien tuvo saldo o movimiento en el año. */
    porTrabajador: {
      nombre: string; moneda: string
      inicialImporte: number; inicialDias: number
      acumuladoImporte: number; acumuladoDias: number
      pagadoImporte: number; pagadoDias: number
      finalImporte: number; finalDias: number
    }[]
  }
  /**
   * Lo que se le debe a ONAT y a la Seguridad Social por el período, sacado de los ítems
   * (`concepto_clave`, nunca el nombre). Hasta ahora había que ir a buscarlo a Cuentas
   * por pagar fila por fila.
   */
  onat:        { concepto: string; monedas: MontoMoneda[] }[]
  /**
   * Coste medio por persona = coste del año ÷ plantilla MEDIA (no la de hoy).
   *
   * Dividir por la plantilla actual sería una media falsa en cuanto haya movimiento: un
   * negocio que empezó el año con 4 y acabó con 12 no tiene el coste repartido entre 12.
   */
  costeMedio:  MontoMoneda[]
  /**
   * Rotación del año: bajas ÷ plantilla media × 100, con las piezas del cálculo delante.
   *
   * Se enseñan `plantillaInicio` y `plantillaFin` porque un índice suelto no se puede
   * discutir: con 2 bajas sobre una plantilla media de 3, un 66 % asusta hasta que se ve
   * que el negocio tiene tres personas.
   */
  rotacion:    {
    plantillaInicio: number
    plantillaFin:    number
    plantillaMedia:  number
    /** `null` cuando la plantilla media es 0: un porcentaje sobre cero no existe. */
    indice:          number | null
  }
  /**
   * Antigüedad de la plantilla ACTIVA, en años. `null` si nadie tiene fecha de alta
   * utilizable — un cero diría «todos entraron hoy», que es otra cosa.
   */
  antiguedad:  {
    mediaAnios: number | null
    veterano:   { nombre: string; anios: number } | null
  }
  /** Como `porDepto`, pero por puesto. */
  porCargo:    { cargo: string; activos: number; coste: MontoMoneda[] }[]
  /**
   * El FONDO DEL 1,5 % (provisión de Seguridad Social para subsidios por enfermedad).
   *
   * No es un impuesto que se ingrese al Estado: es una provisión interna que se acumula
   * con cada nómina y de la que salen los subsidios por certificado médico. Devengo, mismo
   * patrón que vacaciones: la provisión del 1,5 % ALIMENTA el fondo y el subsidio de
   * enfermedad lo REBAJA (la maternidad no lo toca: la reembolsa el Estado). El saldo puede
   * quedar NEGATIVO —la empresa lo absorbe y lo compensa con lo que acumulará— y no se
   * liquida nunca. Solo bajo modelo cubano. Vacío si el negocio no acumula 1,5 %.
   */
  fondoSubsidios: {
    /** El saldo VIVO al cierre del año, por moneda. Puede ser negativo. */
    total: MontoMoneda[]
    /** El submayor: saldo que se abre, se provisiona, se paga y se cierra, por moneda. */
    porMoneda: {
      moneda: string
      inicial: number
      provisionadoAnio: number
      pagadoAnio: number
      final: number
    }[]
  }
}

/**
 * Movimiento del fondo del 1,5 % ya partido a un lado y otro del 1 de enero del año, por
 * moneda: lo anterior abre el saldo, lo del año es el movimiento. Lo deriva el llamador
 * (recorre las nóminas confirmadas); vacío si la empresa no usa el modelo cubano.
 */
export interface MovFondoSubsidio {
  moneda: string
  /** Provisión del 1,5 % ANTERIOR al año. */
  iniProvision: number
  /** Subsidios por enfermedad pagados ANTES del año. */
  iniPagado: number
  /** Provisión del 1,5 % DEL año. */
  provision: number
  /** Subsidios por enfermedad pagados EN el año. */
  pagado: number
}

/** Lo que hace falta de un ítem de nómina para el resumen de ONAT. */
export interface ItemFiscalRrhh {
  /** Nombre canónico del tributo (ya resuelto por su clave). */
  concepto: string
  moneda:   string
  monto:    number
}

/**
 * El SUBMAYOR de vacaciones de un trabajador para el año del informe: el saldo se abre,
 * se mueve y se cierra, en las DOS unidades a la vez (importe y días). Ya derivado —el
 * llamador reparte las nóminas confirmadas a un lado y otro del 1 de enero del año.
 *   final = inicial + acumulado − pagado   (pagado = disfrute + liquidación por baja)
 */
export interface SaldoVacaciones {
  nombre: string
  moneda: string
  inicialImporte:   number
  inicialDias:      number
  acumuladoImporte: number
  acumuladoDias:    number
  /** Disfrutado + liquidado por baja en el año. */
  pagadoImporte:    number
  pagadoDias:       number
  finalImporte:     number
  finalDias:        number
}

const SIN_DEPTO = 'Sin departamento'
const SIN_CARGO = 'Sin cargo'

/** Días entre dos fechas `YYYY-MM-DD`, por UTC para que no la mueva el horario de verano. */
function diasEntre(desde: string, hasta: string): number {
  const a = Date.parse(`${desde}T00:00:00Z`)
  const b = Date.parse(`${hasta}T00:00:00Z`)
  if (isNaN(a) || isNaN(b)) return 0
  return (b - a) / 86_400_000
}

/** ¿Estaba de alta en esta fecha? Alta anterior o igual, y baja posterior (o ninguna). */
function activoEn(e: EmpleadoRrhh, fecha: string): boolean {
  const alta = e.fecha_alta?.slice(0, 10)
  if (!alta || alta > fecha) return false
  const baja = e.fecha_baja?.slice(0, 10)
  return !baja || baja > fecha
}

function redondea1(n: number): number { return Math.round(n * 10) / 10 }

/** Suma por moneda. Distintas monedas NO se suman en un único número. */
export function porMoneda(entries: MontoMoneda[]): MontoMoneda[] {
  const m = new Map<string, number>()
  for (const e of entries) m.set(e.moneda, (m.get(e.moneda) ?? 0) + e.monto)
  return Array.from(m.entries())
    .map(([moneda, monto]) => ({ moneda, monto }))
    .sort((a, b) => a.moneda.localeCompare(b.moneda))
}

/** Años con nóminas, más el actual, de más reciente a más antiguo. */
export function aniosDisponibles(nominas: { periodo: string }[], anioActual: string): string[] {
  const set = new Set<string>([anioActual])
  for (const n of nominas) if (n.periodo) set.add(n.periodo.slice(0, 4))
  return Array.from(set).sort((a, b) => b.localeCompare(a))
}

export function construirReportesRrhh(
  empleadosTodos: EmpleadoRrhh[],
  nominasTodas: NominaRrhh[],
  empresas: { empresa_id: string; nombre: string }[],
  filtro: { empresaId: string; anio: string },
  /** Ítems fiscales del período ya filtrado (vacío si la empresa no usa el modelo cubano). */
  itemsFiscales: ItemFiscalRrhh[] = [],
  /** Saldos de vacaciones ya derivados, de la plantilla filtrada. */
  saldosVacaciones: SaldoVacaciones[] = [],
  /** Movimiento del fondo del 1,5 % ya partido por año, por moneda (vacío si no hay Cuba). */
  movimientosFondo: MovFondoSubsidio[] = [],
  /**
   * «Hoy» en la zona del NEGOCIO, para la antigüedad. Se pasa y no se lee del reloj: este
   * módulo es puro (lo consumen pantalla, Excel y PDF) y el reloj del navegador ya mintió
   * una vez en esta pantalla, que abría el informe en el año del dispositivo.
   */
  hoy: string = `${filtro.anio}-12-31`,
): ReportesRrhh {
  const { empresaId, anio } = filtro

  // El departamento se resuelve sobre TODA la plantilla, no sobre la filtrada:
  // una nómina puede tener una línea de alguien que ya causó baja o que está en
  // otra empresa, y sin su departamento ese coste caería en «Sin departamento».
  const deptoDe = new Map<string, string>()
  for (const e of empleadosTodos) deptoDe.set(e.empleado_id, e.departamento || SIN_DEPTO)

  const empleados = empleadosTodos.filter(e => !empresaId || e.empresa_id === empresaId)
  const nominas   = nominasTodas.filter(n =>
    (!empresaId || n.empresa_id === empresaId) &&
    n.estado === 'CONFIRMADA' &&
    n.periodo.startsWith(anio))

  const plantilla = empleados.filter(e => e.estado === 'ACTIVO').length
  const altas     = empleados.filter(e => e.fecha_alta?.slice(0, 4) === anio).length
  const bajas     = empleados.filter(e => e.fecha_baja && e.fecha_baja.slice(0, 4) === anio).length

  const costeAnual = porMoneda(nominas.map(n => ({ moneda: n.moneda, monto: costeDe(n) })))

  const porPeriodo = new Map<string, MontoMoneda[]>()
  for (const n of nominas) {
    const arr = porPeriodo.get(n.periodo) ?? []
    arr.push({ moneda: n.moneda, monto: costeDe(n) })
    porPeriodo.set(n.periodo, arr)
  }
  const costePorMes = Array.from(porPeriodo.entries())
    .map(([periodo, e]) => ({ periodo, monedas: porMoneda(e) }))
    .sort((a, b) => b.periodo.localeCompare(a.periodo))

  const headcount = new Map<string, number>()
  for (const e of empleados) {
    if (e.estado !== 'ACTIVO') continue
    const d = e.departamento || SIN_DEPTO
    headcount.set(d, (headcount.get(d) ?? 0) + 1)
  }
  const costeDepto = new Map<string, MontoMoneda[]>()
  for (const n of nominas) {
    for (const l of n.lineas) {
      const d = deptoDe.get(l.empleado_id) ?? SIN_DEPTO
      const arr = costeDepto.get(d) ?? []
      arr.push({ moneda: n.moneda, monto: l.devengado })
      costeDepto.set(d, arr)
    }
  }
  const porDepto = Array.from(new Set<string>([...headcount.keys(), ...costeDepto.keys()]))
    .sort()
    .map(d => ({ departamento: d, activos: headcount.get(d) ?? 0, coste: porMoneda(costeDepto.get(d) ?? []) }))

  // Desglose por empresa SOLO en la vista consolidada: con una empresa filtrada
  // sería la misma cifra otra vez.
  const porEmpresa = empresaId ? [] : empresas
    .map(emp => ({
      empresa_id: emp.empresa_id,
      nombre:     emp.nombre,
      activos:    empleadosTodos.filter(e => e.empresa_id === emp.empresa_id && e.estado === 'ACTIVO').length,
      coste:      porMoneda(
        nominasTodas
          .filter(n => n.empresa_id === emp.empresa_id && n.estado === 'CONFIRMADA' && n.periodo.startsWith(anio))
          .map(n => ({ moneda: n.moneda, monto: costeDe(n) })),
      ),
    }))
    .filter(e => e.activos > 0 || e.coste.length > 0)

  // ── El submayor de vacaciones ─────────────────────────────────────────────────
  // Un saldo que se abre, se mueve y se cierra, en las dos unidades. Se enseña a quien
  // tuvo saldo O movimiento en el año: una fila con seis ceros no es información, pero un
  // trabajador liquidado —final 0 pero con acumulado y pago en el año— sí lo es. El total
  // es la DEUDA VIVA (saldo final) por moneda; dos monedas no se suman en un número.
  const conMovimiento = saldosVacaciones
    .filter(v => Math.abs(v.finalImporte) > 0.005 || Math.abs(v.acumuladoImporte) > 0.005
      || Math.abs(v.pagadoImporte) > 0.005 || Math.abs(v.inicialImporte) > 0.005)
    .sort((a, b) => b.finalImporte - a.finalImporte)
  const vacaciones = {
    total: porMoneda(conMovimiento.map(v => ({ moneda: v.moneda, monto: v.finalImporte }))),
    porTrabajador: conMovimiento.map(v => ({
      nombre: v.nombre, moneda: v.moneda,
      inicialImporte: v.inicialImporte, inicialDias: v.inicialDias,
      acumuladoImporte: v.acumuladoImporte, acumuladoDias: v.acumuladoDias,
      pagadoImporte: v.pagadoImporte, pagadoDias: v.pagadoDias,
      finalImporte: v.finalImporte, finalDias: v.finalDias,
    })),
  }

  // ── Lo que se le debe a ONAT ──────────────────────────────────────────────────
  // Agrupado por CONCEPTO (que llega ya resuelto por su clave, nunca por el nombre que
  // pueda haber cambiado). El orden es el del catálogo fiscal, que es el que el dueño
  // reconoce de su declaración.
  const porConcepto = new Map<string, MontoMoneda[]>()
  for (const i of itemsFiscales) {
    const arr = porConcepto.get(i.concepto) ?? []
    arr.push({ moneda: i.moneda, monto: i.monto })
    porConcepto.set(i.concepto, arr)
  }
  const onat = Array.from(porConcepto.entries())
    .map(([concepto, ms]) => ({ concepto, monedas: porMoneda(ms) }))
    .filter(o => o.monedas.some(m => Math.abs(m.monto) > 0.005))
    .sort((a, b) => a.concepto.localeCompare(b.concepto))

  // ── Plantilla media, coste medio y rotación ───────────────────────────────────
  // La plantilla MEDIA del año, no la de hoy: un negocio que empezó con 4 y acabó con 12
  // no tiene el coste del año repartido entre 12, y su rotación tampoco se mide sobre 12.
  const inicioAnio = `${anio}-01-01`
  const finAnio    = `${anio}-12-31`
  const plantillaInicio = empleados.filter(e => activoEn(e, inicioAnio)).length
  const plantillaFin    = empleados.filter(e => activoEn(e, finAnio)).length
  const plantillaMedia  = redondea1((plantillaInicio + plantillaFin) / 2)

  const costeMedio = plantillaMedia > 0
    ? costeAnual.map(c => ({ moneda: c.moneda, monto: c.monto / plantillaMedia }))
    : []

  const rotacion = {
    plantillaInicio, plantillaFin, plantillaMedia,
    // Sobre una plantilla media de 0 no hay porcentaje que dar. `null` y no 0: un 0 %
    // diría «nadie se fue», y lo que pasa es que no había nadie.
    indice: plantillaMedia > 0 ? redondea1((bajas / plantillaMedia) * 100) : null,
  }

  // ── Antigüedad de la plantilla activa ─────────────────────────────────────────
  // La referencia es «hoy» acotado al año que se mira: pedir 2024 no puede devolver la
  // antigüedad de hoy, o el informe de un año cerrado cambiaría cada mañana.
  const referencia = hoy < finAnio ? hoy : finAnio
  const conAlta = empleados
    .filter(e => e.estado === 'ACTIVO' && e.fecha_alta)
    .map(e => ({
      nombre: (e.nombre ?? '').trim() || '—',
      anios:  diasEntre(e.fecha_alta!.slice(0, 10), referencia) / 365.25,
    }))
    .filter(e => e.anios >= 0)
  const veteranoRaw = conAlta.reduce<{ nombre: string; anios: number } | null>(
    (mejor, e) => (!mejor || e.anios > mejor.anios ? e : mejor), null)
  const antiguedad = {
    mediaAnios: conAlta.length
      ? redondea1(conAlta.reduce((s, e) => s + e.anios, 0) / conAlta.length)
      : null,
    veterano: veteranoRaw ? { nombre: veteranoRaw.nombre, anios: redondea1(veteranoRaw.anios) } : null,
  }

  // ── Coste por CARGO ───────────────────────────────────────────────────────────
  // Misma mecánica que el departamento y por el mismo motivo: el cargo se resuelve sobre
  // TODA la plantilla, porque una nómina puede llevar la línea de alguien que ya causó
  // baja y su coste no puede caer en «Sin cargo».
  const cargoDe = new Map<string, string>()
  for (const e of empleadosTodos) cargoDe.set(e.empleado_id, e.cargo || SIN_CARGO)

  const headcountCargo = new Map<string, number>()
  for (const e of empleados) {
    if (e.estado !== 'ACTIVO') continue
    const c = e.cargo || SIN_CARGO
    headcountCargo.set(c, (headcountCargo.get(c) ?? 0) + 1)
  }
  const costeCargo = new Map<string, MontoMoneda[]>()
  for (const n of nominas) {
    for (const l of n.lineas) {
      const c = cargoDe.get(l.empleado_id) ?? SIN_CARGO
      const arr = costeCargo.get(c) ?? []
      arr.push({ moneda: n.moneda, monto: l.devengado })
      costeCargo.set(c, arr)
    }
  }
  const porCargo = Array.from(new Set<string>([...headcountCargo.keys(), ...costeCargo.keys()]))
    .sort()
    .map(c => ({ cargo: c, activos: headcountCargo.get(c) ?? 0, coste: porMoneda(costeCargo.get(c) ?? []) }))

  // ── El fondo del 1,5 % ────────────────────────────────────────────────────────
  // Se agrega por MONEDA (un fondo es dinero, no se mezclan monedas en un número). El
  // saldo inicial = provisión anterior − subsidios de enfermedad pagados antes; el final
  // suma el movimiento del año. Puede ser negativo, y así se muestra: es una deuda de la
  // empresa consigo misma, no un error.
  const fondoAcc = new Map<string, MovFondoSubsidio>()
  for (const m of movimientosFondo) {
    const a = fondoAcc.get(m.moneda) ?? { moneda: m.moneda, iniProvision: 0, iniPagado: 0, provision: 0, pagado: 0 }
    a.iniProvision += m.iniProvision
    a.iniPagado    += m.iniPagado
    a.provision    += m.provision
    a.pagado       += m.pagado
    fondoAcc.set(m.moneda, a)
  }
  const fondoPorMoneda = Array.from(fondoAcc.values())
    .map(m => {
      const inicial = m.iniProvision - m.iniPagado
      return {
        moneda: m.moneda,
        inicial,
        provisionadoAnio: m.provision,
        pagadoAnio: m.pagado,
        final: inicial + m.provision - m.pagado,
      }
    })
    .filter(f => Math.abs(f.inicial) > 0.005 || Math.abs(f.provisionadoAnio) > 0.005
      || Math.abs(f.pagadoAnio) > 0.005 || Math.abs(f.final) > 0.005)
    .sort((a, b) => a.moneda.localeCompare(b.moneda))
  const fondoSubsidios = {
    total: fondoPorMoneda.map(f => ({ moneda: f.moneda, monto: f.final })),
    porMoneda: fondoPorMoneda,
  }

  return {
    plantilla, altas, bajas, costeAnual, costePorMes, porDepto, porEmpresa, vacaciones, onat,
    costeMedio, rotacion, antiguedad, porCargo, fondoSubsidios,
  }
}

/** «Enero 2026» a partir de un período 'YYYY-MM'. */
export function formatMesRrhh(periodo: string): string {
  const [y, m] = periodo.split('-').map(Number)
  if (!y || !m) return periodo
  const s = new Date(y, m - 1, 1).toLocaleDateString('es-ES', { month: 'long', year: 'numeric' })
  return s.charAt(0).toUpperCase() + s.slice(1)
}
