// ── Parámetros del presupuesto de instalación (fuente única, editable) ──
// Números de Formulario_Instalacion_Especificacion.md §2. Aislados aquí para
// afinarlos fácil; promoverlos a /admin/configuracion es un follow-up trivial.
// Es lógica pura (isomórfica): la usa el cálculo en cliente (vista previa en
// vivo) y en servidor (recálculo autoritativo al guardar).

export type TarifaTipo = 'fundador' | 'estandar'
export type FormatoDatos = 'excel' | 'papel' | 'sistema' | 'cero'

export const FORMATOS: { key: FormatoDatos; label: string }[] = [
  { key: 'excel',   label: 'Ya están en una hoja de cálculo organizada (Excel/Sheets)' },
  { key: 'papel',   label: 'En papel, fotos o dispersos (cuaderno, WhatsApp, memoria)' },
  { key: 'sistema', label: 'Vienen de otro sistema exportable' },
  { key: 'cero',    label: 'No aplica / empieza desde cero' },
]

// Horas fijas por fase.
export const FASE1_FIJAS = 4   // alta y configuración base
export const FASE3_BASE  = 2   // formación (navegación general + módulo principal)
export const FASE4_FIJAS = 2   // validación y cierre
export const FORMACION_POR_MODULO = 1
export const FORMACION_CAJA       = 2   // el POS suma +2h en vez de +1h

// Tarifas ($/hora).
export const TARIFA_HORA: Record<TarifaTipo, number> = { fundador: 25, estandar: 35 }
export const TARIFA_HISTORICO = 40   // migración de histórico (cotización manual)
export const EXTRA_TRAMO_USD  = 15   // +$15 por tramo excedido en Fase 1

// Umbral orientativo para sugerir tarifa "fundador" (primeros N clientes).
export const LIMITE_FUNDADOR = 20

// ── Fase 1: campos de configuración con límite estándar ──
// Si el valor supera el límite se cobra un extra en $ (no en horas). El extra
// se calcula sobre el tramo del PEOR campo (no se acumula por campo).
export interface CampoFase1 {
  key:    string
  label:  string
  limite: number
  modulo?: string   // si falta, el campo es siempre visible (depende de la base)
}

export const CAMPOS_FASE1: CampoFase1[] = [
  { key: 'empresas',          label: 'Empresas a configurar',                 limite: 3 },
  { key: 'monedas',           label: 'Monedas a gestionar',                   limite: 3 },
  { key: 'cuentas_tesoreria', label: 'Cuentas de tesorería (bancos/cajas)',   limite: 5 },
  { key: 'turnos_reservas',   label: 'Turnos de reservas',                    limite: 2, modulo: 'reservas_citas' },
  { key: 'servicios_citas',   label: 'Servicios/especialistas de citas',      limite: 5, modulo: 'agenda' },
  { key: 'categorias_catalogo', label: 'Categorías de catálogo/menú',         limite: 10, modulo: 'catalogo_qr' },
  { key: 'puntos_venta',      label: 'Puntos de venta a crear',               limite: 2, modulo: 'caja' },
]

// ── Fase 2: líneas de migración por módulo ──
export interface LineaFase2 {
  key:    string
  label:  string
  horas:  number
  limite: number
  modulo: string   // módulo que activa la línea
  campo:  string   // clave del volumen en `volumenes`
}

export const LINEAS_FASE2: LineaFase2[] = [
  { key: 'terceros',      label: 'Contabilidad · Clientes y proveedores', horas: 2, limite: 20, modulo: 'base',        campo: 'terceros' },
  { key: 'catalogo',      label: 'Catálogo · Productos/servicios',        horas: 2, limite: 20, modulo: 'catalogo_qr', campo: 'productos_catalogo' },
  { key: 'inv_productos', label: 'Inventario · Productos',                horas: 5, limite: 50, modulo: 'inventario',  campo: 'productos_inventario' },
  { key: 'inv_almacenes', label: 'Inventario · Almacenes',               horas: 1, limite: 5,  modulo: 'inventario',  campo: 'almacenes' },
  { key: 'rrhh_personal', label: 'RRHH · Personal',                      horas: 2, limite: 20, modulo: 'rrhh',        campo: 'empleados' },
  { key: 'rrhh_turnos',   label: 'RRHH · Turnos',                        horas: 1, limite: 3,  modulo: 'rrhh',        campo: 'turnos_trabajo' },
  { key: 'rrhh_nomina',   label: 'RRHH · Configuraciones de nómina',     horas: 1, limite: 2,  modulo: 'rrhh',        campo: 'config_nomina' },
]

// Clave del módulo base de contabilidad (no obligatorio; se usa para excluirlo
// de las horas extra de formación en Fase 3, que ya tiene sus 2h base fijas).
export const CLAVE_BASE = 'base'
