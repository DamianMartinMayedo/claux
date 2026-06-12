/**
 * Constantes compartidas del admin de planes (módulos ERP y duración por modalidad).
 * Fuente única — antes estaban duplicadas en NuevoPlanModal/EditarPlanModal/DuplicarPlanBtn.
 *
 * Nota: esta es la lista de módulos del modelo de "planes" actual. El modelo comercial v2
 * (base contable + módulos à la carte) se diseña aparte en docs/MODELO-MODULOS.md.
 */

export interface ModuloDef {
  id:    string
  label: string
}

export const MODULOS: ModuloDef[] = [
  { id: 'ventas',               label: 'Ventas' },
  { id: 'compras',              label: 'Compras' },
  { id: 'tesoreria',            label: 'Tesorería' },
  { id: 'terceros',             label: 'Clientes / Proveedores' },
  { id: 'contabilidad_simple',  label: 'Contabilidad Simple' },
  { id: 'modulo_contable',      label: 'Módulo Contable' },
  { id: 'inventario',           label: 'Inventario' },
  { id: 'rrhh',                 label: 'RR.HH.' },
  { id: 'gestion_documental',   label: 'Gestión Documental' },
  { id: 'rol_contador_externo', label: 'Contador Externo' },
  { id: 'multiempresa',         label: 'Multiempresa' },
  { id: 'presupuestos',         label: 'Presupuestos' },
  { id: 'crm',                  label: 'CRM' },
  { id: 'activos_fijos',        label: 'Activos Fijos' },
]

/** Mapa id → label, derivado de MODULOS (para tablas que solo muestran etiquetas). */
export const MODULOS_LABEL: Record<string, string> = Object.fromEntries(
  MODULOS.map(m => [m.id, m.label]),
)

/** Días de vigencia sugeridos por modalidad de plan. */
export const DURACION_MODALIDAD: Record<string, number> = {
  mensual: 30, trimestral: 90, semestral: 180, anual: 365,
}
